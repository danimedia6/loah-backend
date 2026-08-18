import { Router } from "express";
import { getPeopleWithStories, 
         getThemesSummary, 
         getStories, 
         uploadStory,
         registerView,
         upload,
         toggleLike,
         getStoryViews, 
         getStoryLikes,
         toggleReaction
         } from "./stories.controller.js";
import { optionalAuthMiddleware } from "../../middlewares/auth.middleware.js";

const router = Router();

router.get("/people", optionalAuthMiddleware, getPeopleWithStories);
router.get("/themes", getThemesSummary);
router.get("/", optionalAuthMiddleware, getStories);
router.post("/upload", upload.single("file"), uploadStory);  
router.post("/:id/view", optionalAuthMiddleware, registerView);
router.post("/:id/like", toggleLike);
router.get("/:id/views", getStoryViews);
router.get("/:id/likes", getStoryLikes);
router.post("/:id/reaction", toggleReaction);
export default router;
