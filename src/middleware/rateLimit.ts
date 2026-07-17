import { rateLimit } from "express-rate-limit";

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "too_many_requests",
      message: "Muitas tentativas. Tente novamente mais tarde.",
    },
  },
});
