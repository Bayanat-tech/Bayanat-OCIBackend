import { Request, Response } from "express";
import { FaceRecognitionService } from "../../services/Attendance/face_recognition.service";
import { AttendanceService } from "../../services/Attendance/Attendance.service";
import { validateImage } from "../../middleware/security.middleware";
import logger from "../../utils/logger";

export class AttendanceController {
  // static async markAttendance(req: Request, res: Response): Promise<void> {
  //   try {
  //     const { action } = req.body;
  //     const file = req.file;

  //     if (!file) {
  //       logger.warn("Attendance marking attempt without image");
  //       res.status(400).json({ error: "Face image is required" });
  //       return;
  //     }

  //     if (!["check-in", "check-out"].includes(action)) {
  //       logger.warn(`Invalid attendance action: ${action}`);
  //       res.status(400).json({ error: "Invalid action" });
  //       return;
  //     }

  //     // Validate image
  //     validateImage(req, res, () => {});

  //     // Get FaceRecognitionService instance
  //     const faceService = await FaceRecognitionService.getInstance();

  //     // Recognize face using instance methods
  //     const descriptor = await faceService.extractFaceDescriptor(file.buffer);
  //     const match = await faceService.findBestMatch(descriptor);

  //     if (!match) {
  //       logger.warn("Unrecognized face attempt");
  //       res.status(404).json({ error: "Employee not recognized" });
  //       return;
  //     }

  //     // Record attendance
  //     const { status, timestamp, employeeCode, employeeName } = await AttendanceService.markAttendance(
  //       match.employeeId,
  //       action
  //     );

  //     res.status(200).json({
  //       success: true,
  //       employeeCode,
  //       employeeName,
  //       action,
  //       status,
  //       timestamp: timestamp.toISOString(),
  //     });
  //   } catch (error: any) {
  //     logger.error("Attendance marking error", error);
  //     res.status(500).json({ success: false, message: error.message });
  //   }
  // }

  static async markAttendance(req: Request, res: Response): Promise<void> {
  try {
    const { 
      action, 
      latitude, 
      longitude, 
      accuracy, 
      locationType, 
      address, 
      officeName 
    } = req.body;
    
    const file = req.file;

    if (!file) {
      logger.warn("Attendance marking attempt without image");
      res.status(400).json({ error: "Face image is required" });
      return;
    }

    if (!["check-in", "check-out"].includes(action)) {
      logger.warn(`Invalid attendance action: ${action}`);
      res.status(400).json({ error: "Invalid action" });
      return;
    }

    // Validate image
    validateImage(req, res, () => {});

    // Get FaceRecognitionService instance
    const faceService = await FaceRecognitionService.getInstance();

    // Recognize face using instance methods
    const descriptor = await faceService.extractFaceDescriptor(file.buffer);
    const match = await faceService.findBestMatch(descriptor);

    if (!match) {
      logger.warn("Unrecognized face attempt");
      res.status(404).json({ error: "Employee not recognized" });
      return;
    }

    // 🆕 Prepare location data
    let locationData: any = null;
    
    if (latitude && longitude) {
      locationData = {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        accuracy: accuracy ? parseFloat(accuracy) : null,
        locationType: locationType || 'unknown',
        officeName: officeName || null
      };

      if (address) {
        try {
          locationData.address = typeof address === 'string' ? JSON.parse(address) : address;
        } catch (e) {
          locationData.address = { fullAddress: address };
        }
      }
    }

    // 🆕 Use the new method with location support
    const { status, timestamp, employeeCode, employeeName } = await AttendanceService.markAttendanceWithLocation(
      match.employeeId,
      action,
      locationData
    );

    res.status(200).json({
      success: true,
      employeeCode,
      employeeName,
      action,
      status,
      timestamp: timestamp.toISOString(),
    });
  } catch (error: any) {
    logger.error("Attendance marking error", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

  static async getAttendanceReport(req: Request, res: Response): Promise<void> {
    try {
      const { from_date, to_date, department, page, limit } = req.query;
      console.log("Received query parameters:", req.query);

      if (!from_date || !to_date) {
        res.status(400).json({ error: "From date and to date are required" });
        return;
      }

      const report = await AttendanceService.getAttendanceReport(
        new Date(from_date as string),
        new Date(to_date as string),
        department as string | undefined,
        Number(page) || 1,
        Number(limit) || 20
      );

      res.status(200).json(report);
    } catch (error: any) {
      logger.error("Attendance report error", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}
