import { Router } from 'express'
import { getActiveUsers, heartbeat  } from './social.controller.js'
import storiesRoutes from "./stories.routes.js";
import interestsRoutes from "./interests.routes.js";
import { authMiddleware, optionalAuthMiddleware } from "../../middlewares/auth.middleware.js";

const router = Router()

router.get('/active-users', optionalAuthMiddleware, getActiveUsers)
router.post('/heartbeat', authMiddleware, heartbeat)
router.use("/", interestsRoutes);
router.use("/stories", storiesRoutes);

router.get("/ping-stories", (req, res) => res.json({ ok: true }));

export default router
