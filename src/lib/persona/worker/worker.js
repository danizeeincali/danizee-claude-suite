/**
 * The persona connector as a Cloudflare Worker over a D1 database. Bindings: `DB` (D1, with ../schema.sql applied),
 * `PERSONA_TESTER_KEY` and `PERSONA_CODING_KEY` (secrets, 24+ characters, different), `PERSONA_PRODUCT` (the project's
 * name), `PERSONA_SECRET_PATHS` (optional, comma-separated paths stripped from anything stored).
 */
import { createHandler } from "../http.js";

export default {
  /**
   * @param {Request} request
   * @param {{ DB: object, PERSONA_TESTER_KEY?: string, PERSONA_CODING_KEY?: string, PERSONA_PRODUCT?: string, PERSONA_SECRET_PATHS?: string }} env
   */
  fetch(request, env) {
    return createHandler({
      db: env.DB,
      testerKey: env.PERSONA_TESTER_KEY,
      codingKey: env.PERSONA_CODING_KEY,
      product: env.PERSONA_PRODUCT,
      secretPaths: (env.PERSONA_SECRET_PATHS ?? "").split(",").map((p) => p.trim()).filter(Boolean),
      clientIp: (r) => r.headers.get("cf-connecting-ip"),
    })(request);
  },
};
