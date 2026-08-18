import { Router } from 'express'
import { getActiveUsers, heartbeat  } from './social.controller.js'
import storiesRoutes from "./stories.routes.js";
import { optionalAuthMiddleware } from "../../middlewares/auth.middleware.js";

const router = Router()

router.get('/active-users', optionalAuthMiddleware, getActiveUsers)
router.post('/heartbeat', heartbeat)
router.use("/stories", storiesRoutes);

router.get("/ping-stories", (req, res) => res.json({ ok: true }));

export default router
