import type { AuthenticatedStaff } from "../services/auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedStaff;
    }
  }
}

export {};
