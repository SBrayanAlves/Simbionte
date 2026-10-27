import { Router } from "express";
import * as controller from "./auth.controller.ts";
import { loginRateLimit, refreshRateLimit, registerRateLimit } from "../../middleware/rateLimit.ts";
import { authGuard } from "../../middleware/authGuard.ts";

export const authRouter = Router();

authRouter.post("/auth/register", registerRateLimit, controller.register);
authRouter.post("/auth/login", loginRateLimit, controller.login);
authRouter.post("/auth/refresh", refreshRateLimit, controller.refresh);
authRouter.post("/auth/logout", refreshRateLimit, controller.logout);
authRouter.post("/auth/logout-all", authGuard, controller.logoutAll);
authRouter.get("/me", authGuard, controller.me);
