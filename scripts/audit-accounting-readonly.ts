import "dotenv/config";
import { Client } from "pg";

type Row = Record<string, unknown>;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL absent.");

const target = new URL(connectionString);
const databaseName = target.pathname.replace(/^\//, "");
if (databaseName !== "dev") {
  throw new Error(`Audit refuse: la base cible est '${databaseName}', pas 'dev'.`);
}

const client = new Client({ connectionString });

async function rows(sql: string): Promise<Row[]> {
  return (await client.query(sql)).rows;
}

async function main() {
  await client.connect();
  await client.query("BEGIN TRANSACTION READ ONLY");

  try {
    const tableRows = await rows(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'AccountingSession', 'AccountingCategory', 'AccountingOperation',
          'AccountingAuditLog', 'AccountingReport', 'AccountingGroup',
          'Settlement', 'Order'
        )
      ORDER BY table_name
    `);
    const tables = new Set(tableRows.map((row) => String(row.table_name)));

    const columnRows = await rows(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('AccountingOperation', 'AccountingGroup')
      ORDER BY table_name, ordinal_position
    `);

    const result: Record<string, unknown> = {
      target: { host: target.hostname, port: target.port, database: databaseName },
      tables: [...tables],
      schema: {
        accountingOperationColumns: columnRows
          .filter((row) => row.table_name === "AccountingOperation")
          .map((row) => row.column_name),
        accountingGroupPresent: tables.has("AccountingGroup"),
      },
    };

    if (tables.has("AccountingSession") && tables.has("AccountingCategory") && tables.has("AccountingOperation")) {
      result.counts = (await rows(`
        SELECT
          (SELECT COUNT(*)::int FROM "AccountingSession") AS sessions,
          (SELECT COUNT(*)::int FROM "AccountingSession" WHERE status = 'OPEN') AS open_sessions,
          (SELECT COUNT(*)::int FROM "AccountingSession" WHERE status = 'CLOSED') AS closed_sessions,
          (SELECT COUNT(*)::int FROM "AccountingCategory") AS categories,
          (SELECT COUNT(*)::int FROM "AccountingOperation") AS operations,
          (SELECT COUNT(*)::int FROM "AccountingAuditLog") AS audits,
          (SELECT COUNT(*)::int FROM "AccountingReport") AS reports
      `))[0];

      result.operationIntegrity = (await rows(`
        SELECT
          COUNT(*) FILTER (WHERE o.amount <= 0)::int AS non_positive_amounts,
          COUNT(*) FILTER (
            WHERE o.type <> 'CORRECTION' AND o.type::text <> c.type::text
          )::int AS category_type_mismatches,
          COUNT(*) FILTER (
            WHERE o.source = 'DELIVERY' AND o."originalAmount" IS NULL
          )::int AS delivery_without_original_amount,
          COUNT(*) FILTER (
            WHERE o.source = 'DELIVERY' AND o."deliveryOrderId" IS NULL
          )::int AS grouped_delivery_operations,
          COUNT(*) FILTER (
            WHERE o.source = 'DELIVERY' AND o."deliveryOrderId" IS NOT NULL
          )::int AS individual_delivery_operations,
          COUNT(*) FILTER (
            WHERE o.source = 'MANUAL' AND NOT EXISTS (
              SELECT 1 FROM "AccountingAuditLog" a
              WHERE a."operationId" = o.id AND a.action = 'OPERATION_CREATED'
            )
          )::int AS manual_operations_without_creation_audit,
          COUNT(*) FILTER (
            WHERE s.status = 'CLOSED' AND o."updatedAt" > s."updatedAt"
          )::int AS operations_modified_after_session_close
        FROM "AccountingOperation" o
        JOIN "AccountingCategory" c ON c.id = o."categoryId"
        JOIN "AccountingSession" s ON s.id = o."sessionId"
      `))[0];

      result.deliveryDoubleCountRisk = await rows(`
        SELECT
          s.id AS session_id,
          s.date::date AS session_date,
          COUNT(*) FILTER (WHERE o."deliveryOrderId" IS NULL)::int AS grouped_count,
          COUNT(*) FILTER (WHERE o."deliveryOrderId" IS NOT NULL)::int AS individual_count,
          SUM(o.amount)::bigint AS delivery_amount
        FROM "AccountingSession" s
        JOIN "AccountingOperation" o ON o."sessionId" = s.id AND o.source = 'DELIVERY'
        GROUP BY s.id, s.date
        HAVING COUNT(*) FILTER (WHERE o."deliveryOrderId" IS NULL) > 0
           AND COUNT(*) FILTER (WHERE o."deliveryOrderId" IS NOT NULL) > 0
        ORDER BY s.date DESC
        LIMIT 20
      `);

      result.deliveryReconciliation = await rows(`
        WITH expected AS (
          SELECT
            s.id AS session_id,
            COALESCE(SUM(GREATEST(0, o.total + o."deliveryFee" - o.discount)), 0)::bigint AS expected_amount,
            COUNT(o.id)::int AS expected_orders
          FROM "AccountingSession" s
          LEFT JOIN "Order" o ON o."deletedAt" IS NULL
            AND o.status IN ('DELIVERED', 'PARTIALLY_DELIVERED')
            AND (
              (o."deliveryDate" IS NOT NULL AND o."deliveryDate" >= s.date AND o."deliveryDate" < s.date + interval '1 day')
              OR
              (o."deliveryDate" IS NULL AND o."updatedAt" >= s.date AND o."updatedAt" < s.date + interval '1 day')
            )
          GROUP BY s.id
        ), actual AS (
          SELECT
            s.id AS session_id,
            COALESCE(SUM(op.amount) FILTER (WHERE op.source = 'DELIVERY'), 0)::bigint AS actual_amount,
            COUNT(op.id) FILTER (WHERE op.source = 'DELIVERY')::int AS actual_operations
          FROM "AccountingSession" s
          LEFT JOIN "AccountingOperation" op ON op."sessionId" = s.id
          GROUP BY s.id
        )
        SELECT
          s.date::date AS session_date,
          e.expected_orders,
          e.expected_amount,
          a.actual_operations,
          a.actual_amount,
          (a.actual_amount - e.expected_amount)::bigint AS difference
        FROM "AccountingSession" s
        JOIN expected e ON e.session_id = s.id
        JOIN actual a ON a.session_id = s.id
        WHERE a.actual_amount <> e.expected_amount
        ORDER BY s.date DESC
        LIMIT 30
      `);

      result.sessionTotals = await rows(`
        SELECT
          s.date::date AS session_date,
          s.status,
          COUNT(o.id)::int AS operations,
          COALESCE(SUM(CASE WHEN o.type = 'INCOME' OR (o.type = 'CORRECTION' AND o.amount > 0) THEN ABS(o.amount) ELSE 0 END), 0)::bigint AS income,
          COALESCE(SUM(CASE WHEN o.type = 'EXPENSE' OR (o.type = 'CORRECTION' AND o.amount < 0) THEN ABS(o.amount) ELSE 0 END), 0)::bigint AS expense
        FROM "AccountingSession" s
        LEFT JOIN "AccountingOperation" o ON o."sessionId" = s.id
        GROUP BY s.id, s.date, s.status
        ORDER BY s.date DESC
        LIMIT 30
      `);
    }

    if (tables.has("Settlement") && tables.has("Order")) {
      result.orderContext = await rows(`
        SELECT status, COUNT(*)::int AS orders
        FROM "Order"
        WHERE "deletedAt" IS NULL
        GROUP BY status
        ORDER BY status
      `);

      result.deliveredOrderDates = (await rows(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'PARTIALLY_DELIVERED'))::int AS delivered_orders,
          COUNT(*) FILTER (
            WHERE status IN ('DELIVERED', 'PARTIALLY_DELIVERED') AND "deliveryDate" IS NOT NULL
          )::int AS with_delivery_date,
          COUNT(*) FILTER (
            WHERE status IN ('DELIVERED', 'PARTIALLY_DELIVERED') AND "deliveredAt" IS NOT NULL
          )::int AS with_delivered_at,
          COUNT(*) FILTER (
            WHERE status IN ('DELIVERED', 'PARTIALLY_DELIVERED')
              AND "deliveryDate" IS NOT NULL
              AND "deliveredAt" IS NOT NULL
              AND "deliveryDate"::date <> "deliveredAt"::timestamptz::date
          )::int AS conflicting_delivery_dates
        FROM "Order"
        WHERE "deletedAt" IS NULL
      `))[0];

      result.settlementIntegrity = (await rows(`
        SELECT
          COUNT(*)::int AS settlements,
          COUNT(*) FILTER (WHERE amount < 0 OR "productsAmount" < 0 OR "deliveryFeesAmount" < 0)::int AS negative_amounts,
          COUNT(*) FILTER (WHERE amount <> "productsAmount" + "deliveryFeesAmount")::int AS component_mismatches,
          COUNT(*) FILTER (WHERE "ordersCount" <> actual_orders)::int AS order_count_mismatches
        FROM (
          SELECT s.*, COUNT(o.id)::int AS actual_orders
          FROM "Settlement" s
          LEFT JOIN "Order" o ON o."settlementId" = s.id
          GROUP BY s.id
        ) data
      `))[0];
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
