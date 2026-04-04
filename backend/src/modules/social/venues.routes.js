import { Router } from "express";
import { getVenueById } from "./venues.controller.js";

const router = Router();

router.get("/:id", getVenueById);

export default router;