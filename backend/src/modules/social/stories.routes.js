import { Router } from "express";
import { getPeopleWithStories, 
         getThemesSummary, 
         getStories, 
         uploadStory,
         registerView,
         upload,
         toggleLike,
         getStoryViews, 
         getStoryLikes
         } from "./stories.controller.js";

const router = Router();

router.get("/people", getPeopleWithStories);
router.get("/themes", getThemesSummary);
router.get("/", getStories);
router.post("/upload", upload.single("file"), uploadStory);  
router.post("/:id/view", registerView);    
router.post("/:id/like", toggleLike);
router.get("/:id/views", getStoryViews);
router.get("/:id/likes", getStoryLikes);
export default router;