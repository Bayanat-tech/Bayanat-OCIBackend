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
  getFilesBySrNo,
  getAllVendorFiles,
  getAfFiles,
  editAFFiles,
  deleteFilesAF,
} from "../controllers/files.controller";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import {
  uploadToS3,
  uploadPFToS3,
  uploadVendorAttachmentToS3,
  uploadEmployeeAttachmentToS3,
  uploadAFToS3,
  // uploadPurchaseFilesToS3,
  // uploadCPFilesToS3
  uploadTestFileToS3,
  amlsUploadToS3,
} from "../services/ociUpload.service";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, next) {
    next(null, true);
  },
});
//------------import/export------

//----------file----------
router.get(
  "/:request_number",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getFiles
);

//----------PFfile----------
router.get(
  "/purchaseRequest/:request_number",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getpfFiles
);

//----------AFfile----------
router.get(
  "/accountFiles/:request_number",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getAfFiles
);


router.get(
  "/purchaseFiles/:request_number",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getAfFiles
);


//------Vendor files----------
router.get(
  "/vendor/:request_number",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getHrVendorFiles
);

//------Employee files----------
router.get(
  "/employees/:request_number",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getEmployeeFiles 
);

router.put(
  "/editFiles",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  editFiles
);

router.put(
  "/editPFFile",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  editPFFiles
);

router.put(
  "/editAFFile",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  editAFFiles
);

router.put(
  "/editPurchaseFile",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  editAFFiles
);


router.put(
  "/editVendorFile",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  editHrVendorFiles
);

router.get(
  "/getFilesBySrNo/:request_number/:sr_no",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getFilesBySrNo
);

router.get(
  "/getAllVendorFiles/:request_number",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getAllVendorFiles
);

router.put(
  "/editEmployeeFile",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  editEmployeeFiles
);

router.post(
  "/upload",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  upload.single("file"),
  uploadToS3
);

router.post(
  "/uploadFilePf",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  upload.single("file"),
  uploadPFToS3
);

router.post(
  "/uploadFileAf",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  upload.single("file"),
  uploadAFToS3
);

router.post(
  "/uploadFilePurchase",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  upload.single("file"),
  uploadAFToS3
);


router.post(
  "/uploadVendorAttachment",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  upload.single("file"),
  uploadVendorAttachmentToS3
);

router.post(
  "/uploadEmployeeAttachment",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  upload.single("file"),
  uploadEmployeeAttachmentToS3
);

router.delete(
  "/delete",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  deleteFiles
);

router.delete(
  "/deletePF/:request_number/:sr_no",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  deleteFilesPF
);

router.delete(
  "/deleteAF/:request_number/:sr_no",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  deleteFilesAF
);

router.delete(
  "/deletepurchase/:request_number/:sr_no",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  deleteFilesAF
);

router.delete(
  "/deleteVendorAttachment/:request_number/:sr_no/:attachment_sr_no?",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  deleteHrVendorFiles
);

router.delete(
  "/deleteEmployeeFiles/:request_number(.+)/:sr_no",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  deleteEmployeeFiles
);

router.post(
  "/uploadTestFile",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  upload.single("file"),
  uploadTestFileToS3
)

router.post(
  "/amlsUploadToS3",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  upload.single("file"),
  amlsUploadToS3
);

export default router;
