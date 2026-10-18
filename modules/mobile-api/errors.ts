/** Erreur metier de l'API mobile : message affichable + code stable pour l'application. */
export class MobileApiError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "BAD_REQUEST") {
    super(message);
    this.name = "MobileApiError";
  }
}
