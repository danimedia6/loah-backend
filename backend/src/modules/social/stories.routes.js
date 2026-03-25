import { Router } from "express";
import { getPeopleWithStories, 
         getThemesSummary, 
         getStories, 
         uploadStory,
         registerView,
         upload, } from "./stories.controller.js";

const router = Router();

router.get("/people", getPeopleWithStories);
router.get("/themes", getThemesSummary);
router.get("/", getStories);
router.post("/upload", upload.single("file"), uploadStory);  
router.post("/:id/view", registerView);    

export default router;