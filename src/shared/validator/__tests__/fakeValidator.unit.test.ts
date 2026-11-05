import { createWorkbookValidator } from "../registry";
import { runValidatorContract } from "./validatorContract";

runValidatorContract("fake", () => createWorkbookValidator("fake"));
