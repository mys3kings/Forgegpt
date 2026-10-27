import { Router, type IRouter } from "express";
import healthRouter from "./health";
import forgeRouter from "./forge";

const router: IRouter = Router();

router.use(healthRouter);
router.use(forgeRouter);

export default router;
