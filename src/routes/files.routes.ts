import * as express from "express";
import multer from "multer";
import passport from "passport";
import {
  deleteFiles,
  editFiles,
  editPFFiles,
  getFiles,
  getpfFiles,
  deleteFilesPF,
  getHrVendorFiles,
  editHrVendorFiles,
  deleteHrVendorFiles,
  getEmployeeFiles,
  editEmployeeFiles,
  deleteEmployeeFiles,
} from "../controllers/files.controller";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import {
  uploadToS3,
  uploadPFToS3,
  uploadVendorAttachmentToS3,
  uploadEmployeeAttachmentToS3,
} from "../services/ociUpload.service";
// router for files operations

const router = express.Router();
const upload = multer({
  // store the file in memory
  storage: multer.memoryStorage(),
  // allow all files to be uploaded
  fileFilter(req, file, next) {
    next(null, true);
  },
});
//------------import/export------

//----------file----------
router.get(
  "/:request_number",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getFiles
);

//----------PFfile----------
router.get(
  "/purchaseRequest/:request_number",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getpfFiles
);

//------Vendor files----------
router.get(
  "/vendor/:request_number",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getHrVendorFiles
);

//------Employee files----------
router.post(
  "/employees",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  async (req, res) => {
    if (req.body?.request_number) {
      req.params = req.params || {};
      req.params.request_number = req.body.request_number;
    }
    if (req.body?.modules) {
      req.query = req.query || {};
      req.query.modules = req.body.modules;
    }
    return getEmployeeFiles(req, res);
  }
);

router.put(
  "/editFiles",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  editFiles
);

router.put(
  "/editPFFile",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  editPFFiles
);

router.put(
  "/editVendorFile",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  editHrVendorFiles
);

router.put(
  "/editEmployeeFile",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  editEmployeeFiles
);

router.post(
  "/upload",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  upload.single("file"),
  uploadToS3
);

router.post(
  "/uploadFilePf",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  upload.single("file"),
  uploadPFToS3
);

router.post(
  "/uploadVendorAttachment",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  upload.single("file"),
  uploadVendorAttachmentToS3
);

router.post(
  "/uploadEmployeeAttachment",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  upload.single("file"),
  uploadEmployeeAttachmentToS3
);

router.delete(
  "/delete",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  deleteFiles
);

router.delete(
  "/deletePF/:request_number/:sr_no",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  deleteFilesPF
);

router.delete(
  "/deleteVendorAttachment/:request_number/:sr_no",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  deleteHrVendorFiles
);

router.delete(
  "/deleteEmployeeAttachment/:emp_id",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  deleteEmployeeFiles
);

export default router;
