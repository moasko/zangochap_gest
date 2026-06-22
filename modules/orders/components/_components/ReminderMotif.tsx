"use client";

type ReminderMotifTone = "alternative" | "unavailable" | "partial" | "repro" | "default";

type ReminderMotifProps = {
  motif?: string | null;
  motifs?: string[] | null;
  compact?: boolean;
};

const COLLECTION_STATUS_LABELS: Record<string, string> = {
  alternative: "Alternative proposee",
  collected: "Collecte effectuee",
  unavailable: "Article indisponible",
};

function cleanMotifText(value: unknown) {
  return String(value || "")
    .replace(/\b[a-z0-9_-]{20,}\b/gi, "reference interne")
    .replace(/\s*\[ITEM_ID:[^\]]*\s*\]\s*/gi, " ")
    .replace(/^note\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatReminderMotif(value: unknown) {
  const raw = cleanMotifText(value);
  if (!raw) return { title: "Motif non renseigne", detail: "" };

  const collectionMatch = raw.match(/(?:^.+?\s+a\s+)?COLLECTION_STATUS:([a-z_]+)\s+(.+)$/i);
  if (collectionMatch) {
    const status = collectionMatch[1].toLowerCase();
    const readableStatus = COLLECTION_STATUS_LABELS[status] || "Collecte mise a jour";
    const details = cleanMotifText(collectionMatch[2]);
    const noteMatch = details.match(/\(([^)]+)\)/);
    const note = noteMatch?.[1]?.trim();
    const product = details.split(":").pop()?.replace(/\([^)]*\)/g, "").trim();

    return {
      title: readableStatus,
      detail: [product && product !== details ? product : null, note].filter(Boolean).join(" - "),
    };
  }

  const alternativeMatch = raw.match(/alternative propos[ée]e?\s+pour\s+"([^"]+)"\s*:\s*(.+)$/i);
  if (alternativeMatch) {
    return {
      title: "Alternative proposee",
      detail: `${alternativeMatch[1]} -> ${alternativeMatch[2]}`,
    };
  }

  const statusMatch = raw.match(/^statut\s*:\s*(.+)$/i);
  if (statusMatch) {
    return {
      title: "Statut logistique",
      detail: statusMatch[1].trim(),
    };
  }

  return { title: raw, detail: "" };
}

function getMotifTone(motif?: string | null): ReminderMotifTone {
  const text = cleanMotifText(motif)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (text.includes("alternative") || text.includes("propose")) return "alternative";
  if (text.includes("partiel") || text.includes("incomplet")) return "partial";
  if (text.includes("repro") || text.includes("report")) return "repro";
  if (text.includes("indispo") || text.includes("rupture") || text.includes("pas en stock") || text.includes("manque")) {
    return "unavailable";
  }
  return "default";
}

export function ReminderMotif({ motif, motifs, compact = false }: ReminderMotifProps) {
  const formatted = formatReminderMotif(motif);
  const extraMotifs = (motifs || [])
    .map((item) => formatReminderMotif(item))
    .filter((item) => item.title || item.detail);
  const tone = getMotifTone(motif);

  return (
    <div className={`non-packed-motif-card ${tone} ${compact ? "compact" : ""}`}>
      <div className="non-packed-motif-card-head">
        <span>{tone === "alternative" ? "Alternative" : tone === "partial" ? "Partiel" : tone === "repro" ? "Repro" : "Motif"}</span>
        <strong>{formatted.title}</strong>
      </div>
      {formatted.detail && <div className="non-packed-motif-card-detail">{formatted.detail}</div>}
      {extraMotifs.length > 0 && (
        <div className="non-packed-motif-chip-list">
          {extraMotifs.map((item, index) => (
            <span key={`${item.title}-${item.detail}-${index}`}>
              {item.detail ? `${item.title}: ${item.detail}` : item.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export { formatReminderMotif };
