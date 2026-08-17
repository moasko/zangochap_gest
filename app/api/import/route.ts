import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/modules/auth/actions";
import { generateUniqueRef } from "@/modules/orders/helpers";
import { z } from "zod";

const MAX_IMPORT_ROWS = 1_000;
const importRowSchema = z.record(z.string(), z.unknown());

function textValue(row: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function integerValue(row: Record<string, unknown>, keys: string[], fallback = 0) {
  const raw = textValue(row, keys);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Valeur numérique invalide pour ${keys[0]}.`);
  }
  return value;
}

function slugify(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "sans-categorie";
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    if (!["admin", "developer"].includes(session.role)) {
      return NextResponse.json({ error: "Droits administrateur requis." }, { status: 403 });
    }
    const user = session;

    const type = req.nextUrl.searchParams.get('type');
    if (type !== "products" && type !== "orders") {
      return NextResponse.json({ error: "Type d'import invalide." }, { status: 400 });
    }

    const body: unknown = await req.json();
    if (!Array.isArray(body) || body.length === 0 || body.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `L'import doit contenir entre 1 et ${MAX_IMPORT_ROWS} lignes.` },
        { status: 400 },
      );
    }

    const parsedRows = z.array(importRowSchema).safeParse(body);
    if (!parsedRows.success) {
      return NextResponse.json({ error: "Format d'import invalide." }, { status: 400 });
    }
    const data = parsedRows.data;

    let count = 0;
    const errors: Array<{ row: number; error: string }> = [];

    if (type === 'products') {
      for (const [index, item] of data.entries()) {
        try {
          const categoryName = textValue(item, ["category", "categorie"], "Accessoires");
          const supplierName = textValue(item, ["supplier", "fournisseur"]);
          await prisma.product.create({
            data: {
              name: textValue(item, ["name", "nom"], "Sans nom"),
              category: {
                connectOrCreate: {
                  where: { name: categoryName },
                  create: { name: categoryName, slug: slugify(categoryName) },
                },
              },
              price: integerValue(item, ["price", "prix"]),
              oldPrice: textValue(item, ["oldPrice"]) ? integerValue(item, ["oldPrice"]) : null,
              description: textValue(item, ["description"]),
              material: textValue(item, ["material", "matiere"]),
              origin: textValue(item, ["origin", "provenance"]),
              stock: integerValue(item, ["stock"]),
              location: textValue(item, ["location", "emplacement"]),
              supplier: supplierName
                ? {
                    connectOrCreate: {
                      where: { name: supplierName },
                      create: { name: supplierName },
                    },
                  }
                : undefined,
              createdBy: { connect: { id: user.id } },
            },
          });
          count++;
        } catch (error: unknown) {
          errors.push({ row: index + 1, error: error instanceof Error ? error.message : "Échec de l'import." });
        }
      }
    } else if (type === 'orders') {
      for (const [index, item] of data.entries()) {
        try {
          const commune = textValue(item, ["commune"], "Cocody");
          const ref = await generateUniqueRef(commune);

          await prisma.order.create({
            data: {
              ref,
              customerName: textValue(item, ["customerName", "client"], "Client"),
              customerPhone: textValue(item, ["customerPhone", "telephone"]),
              customerLocation: textValue(item, ["customerLocation", "adresse"]),
              commune,
              total: integerValue(item, ["total"]),
              deliveryFee: integerValue(item, ["deliveryFee", "fraisLivraison"]),
              status: 'PENDING',
              commercialId: user.id,
              commercialName: user.name,
              history: [{
                at: new Date().toISOString(),
                action: `Importé par ${user.name}`,
                by: user.email,
                byName: user.name,
              }],
            },
          });
          count++;
        } catch (error: unknown) {
          errors.push({ row: index + 1, error: error instanceof Error ? error.message : "Échec de l'import." });
        }
      }
    }

    return NextResponse.json({ success: errors.length === 0, count, errors });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur interne lors de l'import." },
      { status: 500 },
    );
  }
}
