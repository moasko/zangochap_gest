// Demarre le planificateur des automatisations au boot du serveur Next.
// L'import reste DANS le bloc conditionnel : Next remplace NEXT_RUNTIME a la
// compilation et exclut ainsi le code Node (prisma/pg) du bundle Edge.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
