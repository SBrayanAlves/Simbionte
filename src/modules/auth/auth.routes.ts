import { Router } from "express";
import * as controller from "./auth.controller.ts";
import { authRateLimit } from "../../middleware/rateLimit.ts";
import { authGuard } from "../../middleware/authGuard.ts";

export const authRouter = Router();

authRouter.post("/auth/register", authRateLimit, controller.register);
authRouter.post("/auth/login", authRateLimit, controller.login);
authRouter.post("/auth/refresh", controller.refresh);
authRouter.post("/auth/logout", controller.logout);
authRouter.get("/me", authGuard, controller.me);
