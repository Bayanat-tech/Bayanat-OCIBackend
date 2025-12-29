import { differenceInMinutes } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import constants from "../../helpers/constants";
import { notifyUser } from '../../helpers/functions'; 
import logger from "../../utils/logger";
import { FaceRecognitionService } from "./face_recognition.service";
import { getSignedUrl, uploadEmployeeFace } from "../../services/ociUpload.service";
import { CacheService } from "./cache.service";
import { AppDataSource, oracleDb, TypeORMService } from "../../database/connection"
import { Between, In, Or } from "typeorm";
import { Employee} from "../../entity/Attendance/employee.entity";
import {AttendanceRecord} from "../../entity/Attendance/attendance_record.entity";
import { AttendanceEvent, AttendanceEventType, AttendanceStatus, DataTransferFlag } from "../../entity/Attendance/attendance_events.entity";
import { ProxyLog } from "../../entity/Attendance/ProxyLog.entity";
import { EmployeeFace } from "../../entity/Attendance/employee_face.entity";
  
// 🎯 FIXED PERFORMANCE CONSTANTS
const AUTO_CONFIRM_DELAY_MS = 10000; // 🆕 INCREASED TO 10 SECONDS FOR FRONTEND BUFFER
const FACE_RECOGNITION_TIMEOUT = 2500;
const DATABASE_QUERY_TIMEOUT = 3000;
const MAX_CONCURRENT_REQUESTS = 15;
const CACHE_TTL = 300;
const MIN_CONFIDENCE_THRESHOLD = 65;

export class AttendanceService {
  private static cache = CacheService.getInstance();
  private static pendingConfirmations = new Map();
  private static cancelledConfirmations = new Set<string>();
  private static faceService: FaceRecognitionService | null = null;
  private static concurrentRequests = 0;

  // 🚀 PRELOAD FACE SERVICE
  static async initializeFaceService(): Promise<void> {
    if (!this.faceService) {
      this.faceService = await FaceRecognitionService.getInstance();
    }
  }

  // 🚀 RATE LIMITING
  private static async acquireRequestSlot(): Promise<boolean> {
    if (this.concurrentRequests >= MAX_CONCURRENT_REQUESTS) {
      return false;
    }
    this.concurrentRequests++;
    return true;
  }

  private static releaseRequestSlot(): void {
    this.concurrentRequests = Math.max(0, this.concurrentRequests - 1);
  }

  // 🎯 FIXED MARK ATTENDANCE WITH BETTER TIMING
  // 🎯 OPTIMIZED: MARK ATTENDANCE WITHOUT IMMEDIATE S3 UPLOAD
  static async markAttendanceWithAutoConfirm(
  employeeId: string,
  action: "check-in" | "check-out",
  imageBuffer: Buffer,
  locationData?: any
): Promise<{ 
  status: string; 
  timestamp: Date; 
  employeeCode: string; 
  employeeName: string;
  employeeFirstName: string;
  uuid: string;
  confidence: number;
  requiresConfirmation: boolean;
  recognizedEmployee: any; 
  autoConfirmDelay: number;
}> {
  const startTime = Date.now();
  const uuid = uuidv4();
  const now = new Date();

  if (!await this.acquireRequestSlot()) {
    throw new Error("System busy. Please try again.");
  }

  try {
    console.log("🟢 employeeId =", employeeId);
    // 🎯 PARALLEL OPERATIONS - NO S3 UPLOAD HERE
    const [employee, confidence] = await Promise.all([
      this.getEmployeeWithCache(employeeId),
      this.calculateFaceConfidenceBalanced(employeeId, imageBuffer),
      // 🆕 REMOVED S3 UPLOAD FROM INITIAL FLOW
    ]);

    if (!employee) {
      throw new Error("Employee not found");
    }

    const firstName = this.getFirstName(employee.full_name);

    // 🎯 STORE IN MEMORY WITH AUTO-CONFIRM TIME AND IMAGE BUFFER
    const pendingData = {
      uuid,
      employee_id: employeeId,
      employee_code: employee.employee_code,
      employee_name: employee.full_name,
      employee_first_name: firstName,
      action,
      confidence,
      timestamp: now,
      location_data: locationData,
      s3_image_url: null, // 🆕 WILL BE SET ONLY IF CANCELLED
      image_buffer: imageBuffer, // 🆕 STORE BUFFER FOR POTENTIAL CANCELLATION
      auto_confirm_time: new Date(now.getTime() + AUTO_CONFIRM_DELAY_MS),
      is_cancelled: false,
      autoConfirmTimer: null as NodeJS.Timeout | null
    };

    this.pendingConfirmations.set(uuid, pendingData);

    // 🎯 FIXED: DELAYED AUTO-CONFIRM SCHEDULING
    const autoConfirmTimer = setTimeout(async () => {
      try {
        // 🆕 COMPREHENSIVE CANCELLATION CHECK
        const currentData = this.pendingConfirmations.get(uuid);
        if (!currentData || currentData.is_cancelled) {
          logger.info(`🛑 Auto-confirm cancelled for UUID: ${uuid}`);
          return;
        }

        const isCancelledInDB = await this.isCancelledInDatabase(uuid);
        if (isCancelledInDB) {
          this.pendingConfirmations.delete(uuid);
          this.cancelledConfirmations.add(uuid);
          logger.info(`🛑 Auto-confirm skipped - cancelled in DB: ${uuid}`);
          return;
        }

        await this.autoConfirmFromMemory(uuid);
      } catch (err) {
        logger.error('Auto-confirm scheduling failed:', err);
      }
    }, AUTO_CONFIRM_DELAY_MS);

    // 🆕 STORE TIMER REFERENCE FOR CANCELLATION
    pendingData.autoConfirmTimer = autoConfirmTimer;
    this.pendingConfirmations.set(uuid, pendingData);

    // 🎯 BACKGROUND DATABASE SAVE
    this.saveAttendanceToDatabase(pendingData)
      .catch(err => logger.error('Background database save failed:', err));

    const processingTime = Date.now() - startTime;
    logger.info(`✅ Attendance marked in ${processingTime}ms for ${employeeId}, Auto-confirm in ${AUTO_CONFIRM_DELAY_MS}ms`);

    return {
      status: 'pending_auto_confirm',
      timestamp: now,
      employeeCode: employee.employee_code,
      employeeName: employee.full_name,
      employeeFirstName: firstName,
      uuid: uuid,
      confidence: confidence,
      requiresConfirmation: true,
      autoConfirmDelay: AUTO_CONFIRM_DELAY_MS,
      recognizedEmployee: {
        code: employee.employee_code,
        name: employee.full_name,
        firstName: firstName,
        department: employee.department,
        image: await this.getEmployeeImage(employeeId)
      }
    };

  } catch (error: any) {
    logger.error('Attendance marking error:', error);
    throw error;
  } finally {
    this.releaseRequestSlot();
  }
}

  // 🎯 BALANCED FACE CONFIDENCE CALCULATION
  private static async calculateFaceConfidenceBalanced(employeeId: string, imageBuffer: Buffer): Promise<number> {
    try {
      if (!this.faceService) {
        await this.initializeFaceService();
      }

      if (!this.faceService) {
        logger.warn('Face service not available, using default confidence');
        return 85;
      }

      let retries = 2; // Balanced retries for accuracy
      while (retries > 0) {
        try {
          const extractionPromise = this.faceService.extractFaceDescriptor(imageBuffer);
          const timeoutPromise = new Promise<null>((resolve) => 
            setTimeout(() => resolve(null), FACE_RECOGNITION_TIMEOUT)
          );

          const descriptor = await Promise.race([extractionPromise, timeoutPromise]);
          
          if (descriptor) {
            const matchingPromise = this.faceService.findBestMatch(descriptor);
            const matchTimeoutPromise = new Promise<{confidence: number}>((resolve) => 
              setTimeout(() => resolve({confidence: 85}), 1000)
            );

            const match = await Promise.race([matchingPromise, matchTimeoutPromise]);
            return Math.max(match?.confidence || 85, MIN_CONFIDENCE_THRESHOLD);
          }
          
          retries--;
          if (retries > 0) {
            logger.info(`Face detection failed, retrying... ${retries} attempts left`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
        }
      }

      logger.warn('Face detection failed after retries, using high confidence fallback');
      return 88;

    } catch (error) {
      logger.warn('Face confidence calculation failed, using high confidence fallback:', error);
      return 85;
    }
  }

  // 🎯 GET FIRST NAME ONLY FOR VOICE
  private static getFirstName(fullName: string): string {
    return fullName.split(' ')[0] || fullName;
  }

  // 🎯 OPTIMIZED: UPLOAD IMAGE ONLY WHEN NEEDED (CANCELLATION)
  private static async uploadImageIfNeeded(uuid: string): Promise<string | null> {
    try {
      const pendingData = this.pendingConfirmations.get(uuid);
      if (!pendingData || !pendingData.image_buffer) {
        logger.warn(`No image buffer found for UUID: ${uuid}`);
        return null;
      }

      const key = `attendance/${uuid}_${Date.now()}.jpg`;
      const url = await uploadEmployeeFace(pendingData.image_buffer, key, 'image/jpeg');
      logger.info(`📸 S3 upload completed for cancelled attendance UUID: ${uuid}`);
      
      // 🆕 CLEAN UP THE BUFFER TO SAVE MEMORY
      pendingData.image_buffer = null;
      this.pendingConfirmations.set(uuid, pendingData);
      
      return url;
    } catch (error) {
      logger.error('S3 upload for cancellation failed:', error);
      return null;
    }
  }

  // 🎯 OPTIMIZED EMPLOYEE DATA FETCHING
  private static async getEmployeeWithCache(employeeId: string): Promise<any> {
    const cacheKey = `employee:${employeeId}`;

    console.log("Fetching employee with cache key:", cacheKey);
    let employee = await this.cache.get(cacheKey);
    if (employee) { 
      console.log("Employee found in cache: ",employee.employee_code);
    return employee;
  }
    
    const employees = AppDataSource.getRepository(Employee);
 
    const databasePromise = employees.findOne({
      where: { employee_id: employeeId },
      select: ['employee_id', 'employee_code', 'full_name', 'department'],
    });

    const timeoutPromise = new Promise<null>((resolve) => 
      setTimeout(() => resolve(null), DATABASE_QUERY_TIMEOUT)
    );

    employee = await Promise.race([databasePromise, timeoutPromise]);

    if (employee) {
      console.log("Employee found in Db:", {employeeId: employee.employee_id, 
        employee_Code: employee.employee_code, 
        name: employee.full_name});
      await this.cache.set(cacheKey, employee, CACHE_TTL);
    } else {
      console.log("Employee NOT found in Db for ID: ", employeeId)
    }

    return employee;
  }

  // 🎯 BACKGROUND DATABASE SAVE
  private static async saveAttendanceToDatabase(data: any): Promise<void> {
    try {
      const eventData: any = {
        id: uuidv4(),
        employee_id: data.employee_id,
        employee_code: data.employee_code,
        event_time: data.timestamp,
        event_type: data.action === "check-in" ? "check_in" : "check_out",
        data_transfer: "N",
        uuid: data.uuid,
        confidence: data.confidence,
        s3_image_url: null, // 🆕 NO S3 URL INITIALLY
        status: 'pending_auto_confirm',
        auto_confirm_time: data.auto_confirm_time,
      };

      if (data.location_data) {
        Object.assign(eventData, {
          latitude: data.location_data.latitude,
          longitude: data.location_data.longitude,
          accuracy: data.location_data.accuracy,
          location_type: data.location_data.locationType,
          address: data.location_data.address,
          office_name: data.location_data.officeName
        });
      }

      const attendanceRepo = AppDataSource.getRepository(AttendanceEvent);
      const newEvent = attendanceRepo.create(eventData);
      await attendanceRepo.save(newEvent);
      logger.info(`[DB-SAVE] Record saved for UUID: ${data.uuid}`);
      
    } catch (error) {
      logger.error('Background save failed:', error);
    }
  }

  // 🎯 FAST CONFIRM ATTENDANCE
  // 🎯 FAST CONFIRM ATTENDANCE WITH BETTER TIMEOUT
static async confirmAttendance(uuid: string, confirmedBy: string = 'user'): Promise<any> {
  const startTime = Date.now();
  
  if (!await this.acquireRequestSlot()) {
    throw new Error("System busy. Please try again.");
  }

  try {
    // Check cancellation first
    if (this.isAutoConfirmCancelled(uuid) || await this.isCancelledInDatabase(uuid)) {
      throw new Error("Attendance has been cancelled");
    }

    // Check memory first (fastest path)
    const pendingData = this.pendingConfirmations.get(uuid);
    if (pendingData) {
      if (pendingData.is_cancelled) {
        throw new Error("Attendance has been cancelled");
      }
      
      this.pendingConfirmations.delete(uuid);
      const result = await this.saveConfirmedAttendance(pendingData, confirmedBy);
      logger.info(`✅ Attendance confirmed from memory in ${Date.now() - startTime}ms`);
      return result;
    }

    // 🆕 REDUCE TIMEOUT FOR DATABASE CONFIRMATION
    const databasePromise = this.confirmAttendanceFromDatabase(uuid, confirmedBy);
    const timeoutPromise = new Promise<any>((_, reject) => 
      setTimeout(() => reject(new Error('Confirmation timeout - system busy')), 5000) 
    );

    const result = await Promise.race([databasePromise, timeoutPromise]);
    logger.info(`✅ Attendance confirmed from DB in ${Date.now() - startTime}ms`);
    return result;

  } catch (error) {
    logger.error('Confirmation failed:', error);
    throw error;
  } finally {
    this.releaseRequestSlot();
  }
  }
  //🎯 DATABASE CONFIRMATION
  private static async confirmAttendanceFromDatabase(uuid: string, confirmedBy: string): Promise<any> {
    const transaction = AppDataSource.createQueryRunner();
    const attendanceEvent = AppDataSource.getRepository(AttendanceEvent);
    const attendanceRecord = AppDataSource.getRepository(AttendanceRecord);

    try {
      await transaction.connect();
      await transaction.startTransaction();
      
      // Use QueryBuilder with transaction manager for pessimistic lock
      const event = await transaction.manager.getRepository(AttendanceEvent)
        .createQueryBuilder('event')
        .where('event.uuid = :uuid', { uuid })
        .setLock("pessimistic_write")
        .getOne();

      if (!event) {
        await transaction.rollbackTransaction();
        return { found: false, message: "Attendance event not found", uuid };
      }

      if (event.status === AttendanceStatus.CANCELLED) {
        await transaction.rollbackTransaction();
        throw new Error("Attendance has been cancelled");
      }

      if (event.status !== AttendanceStatus.PENDING) {
        await transaction.rollbackTransaction();
        return { found: true, alreadyProcessed: true, status: event.status, event };
      }

      const today = new Date(event.event_time);
      today.setHours(0, 0, 0, 0);
      const now = new Date();

      let record = await attendanceRecord.findOne({
        where: { employee_id: event.employee_id, record_date: today }
      });
      if (!record) {
        record = attendanceRecord.create({
          id: uuidv4(),
          employee_id: event.employee_id,
          employee_code: event.employee_code,
          record_date: today,
          first_check_in: event.event_type === "check_in" ? event.event_time : null,
          check_in: event.event_type === "check_in" ? event.event_time : null,
          status: "present",
          last_check_out: event.event_type === "check_out" ? event.event_time : null,
          check_out: event.event_type === "check_out" ? event.event_time : null,
          total_hours: 0,
        });
        await attendanceRecord.save(record);
      }
      
      if (event.event_type === "check_in") {
        const updates: any = {
          check_in: event.event_time,
          status: this.calculateStatus(event.event_time, "10:00")
        };
        if (!record.first_check_in || event.event_time < record.first_check_in) {
          updates.first_check_in = event.event_time;
        }
        await (AttendanceRecord as any).update(updates, { where: { id: record.id }, transaction });
      } else {
        const updates: any = { check_out: event.event_time };
        if (!record.last_check_out || event.event_time > record.last_check_out) {
          updates.last_check_out = event.event_time;
        }
        if (record.first_check_in && event.event_time) {
          const minutes = differenceInMinutes(event.event_time, record.first_check_in);
          updates.total_hours = Number((minutes / 60).toFixed(2));
        }
        await attendanceRecord.update( { id: record.id }, updates);
      }

      await attendanceEvent.update({ uuid }, {
        status: AttendanceStatus.CONFIRMED,
        confirmed_by: confirmedBy,
        confirmed_at: now,
        attendance_record_id: record.id
      });

      await transaction.commitTransaction();
      return { found: true, alreadyProcessed: false, event, record };
    } catch (error) {
      await transaction.rollbackTransaction();
      logger.error(`Failed to confirm attendance ${uuid}:`, error);
      throw error;
    }
  }
  
  static async cancelAttendance(
  uuid: string, 
  actualEmployeeCode: string = 'NOT_RECOGNIZED', 
  actualEmployeeName: string = 'User Cancelled',
  reason: string = 'user_cancelled'
): Promise<any> {
  const startTime = Date.now();
  
  if (!await this.acquireRequestSlot()) {
    throw new Error("System busy. Please try again.");
  }

  try {
    const wasCancelled = this.stopAutoConfirm(uuid);
    
    if (!wasCancelled) {
      logger.warn(`[CANCEL] UUID ${uuid} not found in memory, trying database`);
    }

    // 🆕 CHECK IF ALREADY CONFIRMED IN MEMORY
    const pendingData = this.pendingConfirmations.get(uuid);
    if (pendingData && pendingData.is_cancelled) {
      logger.info(`[CANCEL] UUID ${uuid} already cancelled in memory`);
    }

    // 🎯 ALWAYS TRY DATABASE CANCELLATION FOR EMAIL FUNCTIONALITY
    logger.info(`[CANCEL] Proceeding with database cancellation for UUID: ${uuid}, Reason: ${reason}`);
    const result = await this.cancelAttendanceFromDatabase(uuid, actualEmployeeCode, actualEmployeeName, reason);
    
    logger.info(`✅ Attendance cancelled in ${Date.now() - startTime}ms`);
    return result;

  } catch (err: unknown) {
    logger.error('Cancellation failed:', err);
    
    // 🆕 BETTER ERROR MESSAGES (safe handling for unknown)
    const errorMessage = err instanceof Error ? err.message : String(err || '');

    if (errorMessage.includes('already confirmed')) {
      throw new Error("Attendance already confirmed and cannot be cancelled");
    } else if (errorMessage.includes('not found')) {
      throw new Error("Attendance record not found");
    } else {
      throw new Error("Cancellation failed: " + errorMessage);
    }
  } finally {
    this.releaseRequestSlot();
  }
  }

  static stopAutoConfirm(uuid: string): boolean {
  const pendingData = this.pendingConfirmations.get(uuid);
  
  if (pendingData) {
    // 🆕 CLEAR THE AUTO-CONFIRM TIMER
    if (pendingData.autoConfirmTimer) {
      clearTimeout(pendingData.autoConfirmTimer);
      pendingData.autoConfirmTimer = null;
      logger.info(`🛑 Cleared auto-confirm timer for UUID: ${uuid}`);
    }
    
    pendingData.is_cancelled = true;
    this.pendingConfirmations.set(uuid, pendingData);
  }
  
  const wasPending = this.pendingConfirmations.has(uuid);
  this.cancelledConfirmations.add(uuid);
  
  this.markAsCancelledInDatabase(uuid).catch(err => 
    logger.error('Failed to update database cancellation:', err)
  );
  
  logger.info(`🛑 Auto-confirm stopped for UUID: ${uuid}, was pending: ${wasPending}`);
  return wasPending;
}

  private static async autoConfirmFromMemory(uuid: string): Promise<void> {
  if (this.isAutoConfirmCancelled(uuid)) {
    this.pendingConfirmations.delete(uuid);
    logger.info(`🛑 Auto-confirm skipped - cancelled in memory: ${uuid}`);
    return;
  }

  const pendingData = this.pendingConfirmations.get(uuid);
  if (!pendingData) {
    logger.warn(`🛑 Auto-confirm skipped - no pending data: ${uuid}`);
    return;
  }

  // 🆕 FINAL MEMORY CHECK
  if (pendingData.is_cancelled) {
    this.pendingConfirmations.delete(uuid);
    return;
  }

  let transaction;
  try {
    // 🆕 ENSURE CONNECTION HEALTH BEFORE TRANSACTION
    await TypeORMService.ensureConnection();
    
   await AppDataSource.transaction (async (entity) => {
    const attendanceEvent = entity.getRepository(AttendanceEvent);
    const event = await attendanceEvent
      .createQueryBuilder('event')
      .where('event.uuid = :uuid', { uuid })
      .setLock("pessimistic_write")
      .getOne();

    if (!event) {
      //await transaction.rollback();
      logger.warn(`[AUTO-CONFIRM] Event not found in DB: ${uuid}`);
      return;
    }

    if (event.status === AttendanceStatus.CANCELLED) {
      //await transaction.rollback();
      this.pendingConfirmations.delete(uuid);
      this.cancelledConfirmations.add(uuid);
      logger.info(`🛑 Auto-confirm skipped - cancelled in DB: ${uuid}`);
      return;
    }

    // If already confirmed, skip
    if (event.status === 'confirmed') {
      //await transaction.rollback();
      this.pendingConfirmations.delete(uuid);
      logger.info(`🛑 Auto-confirm skipped - already confirmed: ${uuid}`);
      return;
    }

    // 🆕 ADDITIONAL CHECK: VERIFY IT'S STILL PENDING_AUTO_CONFIRM
    if (event.status !== 'pending_auto_confirm') {
      //await transaction.rollback();
      this.pendingConfirmations.delete(uuid);
      logger.info(`🛑 Auto-confirm skipped - invalid state: ${event.status}`);
      return;
    }

    // Remove from memory first to prevent double processing
    this.pendingConfirmations.delete(uuid);
    
    // Now proceed with confirmation (NO S3 UPLOAD FOR SUCCESS)
    await this.saveConfirmedAttendance(pendingData, 'auto_system', entity);
    //await transaction.commit();
    
    logger.info(`✅ Auto-confirmed: ${uuid} (No S3 upload for successful attendance)`);

    });
  } catch (error: any) {
    // 🆕 CONNECTION ERROR HANDLING
    const errorMsg = error?.message || String(error);
    
    // Check for connection errors
    if (errorMsg.includes('ORA-03113') || errorMsg.includes('NJS-500') || errorMsg.includes('not connected')) {
      logger.error(`[AUTO-CONFIRM] Connection error for ${uuid}: ${errorMsg}`);
      try {
        await TypeORMService.ensureConnection();
        logger.info(`[AUTO-CONFIRM] Connection restored, but skipping auto-confirm for ${uuid}`);
      } catch (reconnectErr) {
        logger.error(`[AUTO-CONFIRM] Failed to restore connection:`, reconnectErr);
      }
      return;
    }
    
    // 🆕 SPECIFIC ERROR HANDLING
    if (error && (error as any).name === 'SequelizeTimeoutError') {
      logger.warn(`[AUTO-CONFIRM] Transaction timeout for UUID: ${uuid} - might be getting cancelled`);
      return;
    } else {
      logger.error(`[AUTO-CONFIRM] Failed for ${uuid}:`, error);
    }
  }
}

  // 🎯 SAVE CONFIRMED ATTENDANCE
 // 🎯 UPDATED SAVE CONFIRMED ATTENDANCE WITH TRANSACTION PARAMETER
private static async saveConfirmedAttendance(data: any, confirmedBy: string, existingTransaction?: any): Promise<any> {
  // const useExternalTransaction = !!existingTransaction;
  // const transaction = existingTransaction || await oracleDb.transaction();
  
  try {
    return await AppDataSource.transaction(async (entity) => {
    const today = new Date(data.timestamp);
    today.setHours(0, 0, 0, 0);

    const attendanceRecord = entity.getRepository(AttendanceRecord);
    const attendanceEvent = entity.getRepository(AttendanceEvent);

    let record = await attendanceRecord.findOne({ 
      where: { 
        employee_id: data.employee_id, 
        record_date: today, },
    });
    if (!record) {
       record = attendanceRecord.create({
        id: uuidv4(),
        employee_id: data.employee_id,
        employee_code: data.employee_code,
        record_date: today,
        first_check_in: data.action === "check_in" ? data.timestamp : null,
        check_in: data.action === "check_in" ? data.timestamp : null,
        status: "present",
        last_check_out: data.action === "check_out" ? data.timestamp : null,
        check_out: data.action === "check-out" ? data.timestamp : null,
        total_hours: 0,
      });
      await attendanceRecord.save(record);
    }

    if (data.action === "check-in") {
      const updates: any = {
        check_in: data.timestamp,
        status: this.calculateStatus(data.timestamp, "10:00")
      };
      if (!record.first_check_in || data.timestamp < record.first_check_in) {
        updates.first_check_in = data.timestamp;
      }
      await attendanceRecord.update(updates, { id: record.id });
    } else {
      const updates: any = { check_out: data.timestamp };
      if (!record.last_check_out || data.timestamp > record.last_check_out) {
        updates.last_check_out = data.timestamp;
      }
      if (record.first_check_in && record.last_check_out) {
        const minutes = differenceInMinutes(record.last_check_out, record.first_check_in);
        updates.total_hours = Number((minutes / 60).toFixed(2));
      }
      await attendanceRecord.update({ id: record.id }, updates);

    }

    // Find existing attendance event
    let event: AttendanceEvent | null;
    event = await attendanceEvent.findOne({ where: { uuid: data.uuid } });

    if (!event) {
      const eventData: Partial<AttendanceEvent> = {
        id: uuidv4(),
        employee_id: data.employee_id,
        employee_code: data.employee_code,
        event_time: data.timestamp,
        event_type: data.action === "check-in" ? AttendanceEventType.CHECK_IN : AttendanceEventType.CHECK_OUT,
        data_transfer: DataTransferFlag.N,
        uuid: data.uuid,
        confidence: data.confidence,
        s3_image_url: null, // 🆕 NO S3 URL INITIALLY
        status: AttendanceStatus.CONFIRMED,
        confirmed_by: confirmedBy,
        confirmed_at: new Date(),
        attendance_record_id: record.id
      };

      if (data.location_data) {
        Object.assign(eventData, {
          latitude: data.location_data.latitude,
          longitude: data.location_data.longitude,
          accuracy: data.location_data.accuracy,
          location_type: data.location_data.locationType,
          address: data.location_data.address,
          office_name: data.location_data.officeName
        });
      }

      event = attendanceEvent.create(eventData);
      await attendanceEvent.save(event);
    } else {
      await attendanceEvent.update(
        { id: event.id },
    {
        status: AttendanceStatus.CONFIRMED,
        data_transfer: DataTransferFlag.N,
        confirmed_by: confirmedBy,
        confirmed_at: new Date(),
        attendance_record_id: record.id
      });
    }

    // 🆕 ONLY COMMIT IF WE CREATED THE TRANSACTION
    // if (!useExternalTransaction) {
    //   await transaction.commit();
    // }
    
    return { event, record };
    });
  } catch (error) {
    // 🆕 ONLY ROLLBACK IF WE CREATED THE TRANSACTION
    // if (!useExternalTransaction && transaction) {
    //   await transaction.rollback();
    // }
    
    logger.error('Failed to save confirmed attendance:', error);
    throw error;
  }
}

  // 🎯 LOG PROXY ATTEMPT
  private static async logProxyAttempt(data: any, actualEmployeeCode: string, actualEmployeeName: string, reason: string): Promise<any> {
    const transaction = AppDataSource.createQueryRunner();
    await transaction.connect();
    await transaction.startTransaction();
    
    try {
      const attendanceEvent = AppDataSource.getRepository(AttendanceEvent);
      const ProxyLogs = AppDataSource.getRepository(ProxyLog);
      const employee = transaction.manager.getRepository(Employee);
      
      let event = await attendanceEvent.findOne({ where: { uuid: data.uuid } });

      if (!event) {
        const eventData: any = {
          id: uuidv4(),
          employee_id: data.employee_id,
          employee_code: data.employee_code,
          event_time: data.timestamp,
          event_type: data.action === "check-in" ? "check_in" : "check_out",
          data_transfer: "N",
          uuid: data.uuid,
          confidence: data.confidence,
          s3_image_url: data.s3_image_url,
          status: 'cancelled', //
          confirmed_by: 'cancelled_by_user',
          confirmed_at: new Date(),
        };

        if (data.location_data) {
          Object.assign(eventData, {
            latitude: data.location_data.latitude,
            longitude: data.location_data.longitude,
            accuracy: data.location_data.accuracy,
            location_type: data.location_data.locationType,
            address: data.location_data.address,
            office_name: data.location_data.officeName
          });
        }
  

      event = await attendanceEvent.save(eventData);
      } else {
        event.status = AttendanceStatus.CANCELLED;
        event.confirmed_by = 'cancelled_by_user';
        event.confirmed_at = new Date();
        await attendanceEvent.save(event);
      }

      const proxyEmployee = await employee.findOne({
        where: { employee_code: data.employee_code },
      });

      const proxyLog = ProxyLogs.create({
        id: uuidv4(),
        uuid: data.uuid,
        timestamp: new Date(),  
        proxy_employee_code: data.employee_code,
        proxy_employee_name: proxyEmployee?.full_name || 'Unknown',
        actual_employee_code: actualEmployeeCode,
        actual_employee_name: actualEmployeeName,
        confidence: data.confidence,
        s3_image_url: data.s3_image_url,
        location_data: data.location_data,
        action: data.action === "check-in" ? "check_in" : "check_out",
        action_taken: 'cancelled_by_user',
        device_type: 'web',
        status: 'reported',
        reason: reason,
      });
      await ProxyLogs.save(proxyLog);

      await transaction.commitTransaction();
      return { proxyLog, cancelledEvent: event };

    } catch (error) {
      await transaction.rollbackTransaction();
      logger.error('Failed to log proxy attempt:', error);
      throw error;
    }
  }

 // static async debugEmailFlow(uuid: string): Promise<void> {
//   try {
//     logger.info(`🔍 [EMAIL DEBUG] Starting email debug for UUID: ${uuid}`);
    
//     // Check if UUID exists in pending confirmations
//     const pendingData = this.pendingConfirmations.get(uuid);
//     logger.info(`🔍 [EMAIL DEBUG] Pending data exists: ${!!pendingData}`);
    
//     if (pendingData) {
//       logger.info(`🔍 [EMAIL DEBUG] Pending data:`, {
//         employee_code: pendingData.employee_code,
//         confidence: pendingData.confidence,
//         is_cancelled: pendingData.is_cancelled
//       });
//     }
    
//     // Check database status
//     const event = await AttendanceEvent.findOne({ where: { uuid } });
//     logger.info(`🔍 [EMAIL DEBUG] Database event:`, {
//       exists: !!event,
//       status: event?.status,
//       employee_code: event?.employee_code
//     });
    
//     // Check proxy log
//     const proxyLog = await ProxyLog.findOne({ where: { uuid } });
//     logger.info(`🔍 [EMAIL DEBUG] Proxy log:`, {
//       exists: !!proxyLog,
//       reason: proxyLog?.reason
//     });
    
//   } catch (error) {
//     logger.error(`🔍 [EMAIL DEBUG] Error:`, error);
//   }
// }
  
  private static async cancelAttendanceFromDatabase(
  uuid: string, 
  actualEmployeeCode: string, 
  actualEmployeeName: string, 
  reason: string
): Promise<any> {
  let transaction: any;
  try {
    const transaction = AppDataSource.createQueryRunner();
    const attendanceEvent = AppDataSource.getRepository(AttendanceEvent);
    const ProxyLogs = AppDataSource.getRepository(ProxyLog);
    const employee = AppDataSource.getRepository(Employee);
    logger.info(`[CANCEL] Starting database cancellation for UUID: ${uuid}, Reason: ${reason}`);
    
    await transaction.connect();
    await transaction.startTransaction();

    // 🆕 CORRECT LOCK SYNTAX - Use QueryBuilder for pessimistic lock within transaction
    const event = await transaction.manager.getRepository(AttendanceEvent)
      .createQueryBuilder('event')
      .where('event.uuid = :uuid', { uuid })
      .setLock("pessimistic_write")
      .getOne();

    if (!event) {
      logger.error(`[CANCEL] Event not found for UUID: ${uuid}`);
      throw new Error("Attendance event not found");
    }

    logger.info(`[CANCEL] Found event with status: ${event.status} for UUID: ${uuid}`);

    // 🆕 CHECK IF ALREADY CONFIRMED - PREVENT RACE CONDITION
    if (event.status === AttendanceStatus.CONFIRMED) {
      logger.warn(`[CANCEL] Already confirmed for UUID: ${uuid} - cannot cancel`);
      
      // 🆕 STILL CREATE PROXY LOG BUT DON'T CHANGE STATUS
      const proxyEmployee = await employee.findOne({
        where: { employee_code: event.employee_code },
      });

      const proxyLog = ProxyLogs.create({
        id: uuidv4(),
        uuid: event.uuid,
        timestamp: new Date(),
        proxy_employee_code: event.employee_code,
        proxy_employee_name: proxyEmployee?.full_name || 'Unknown',
        actual_employee_code: actualEmployeeCode,
        actual_employee_name: actualEmployeeName,
        confidence: event.confidence ?? 0,
        s3_image_url: event.s3_image_url ?? null,
        location_data: event.location_data,
        action: event.event_type,
        action_taken: 'attempted_cancellation_after_confirmation',
        device_type: 'web',
        status: 'reported',
        reason: reason + '_after_confirmation',
      });
      await ProxyLogs.save(proxyLog);
      await transaction.commitTransaction();

      // 🆕 SEND SPECIAL EMAIL FOR LATE CANCELLATION ATTEMPT
      // let emailSent = false;
      // if (reason === 'proxy_detected_by_user') {
      //   emailSent = await this.sendLateCancellationEmail(proxyLog, actualEmployeeCode, actualEmployeeName);
      // }

      return { 
        success: false,
        alreadyConfirmed: true,
        proxyLog, 
        //emailSent,
        message: 'Attendance was already confirmed and cannot be cancelled'
      };
    }

    // 🆕 CHECK IF ALREADY CANCELLED
    if (event.status === AttendanceStatus.CANCELLED) {
      await transaction.rollbackTransaction();
      logger.info(`[CANCEL] Already cancelled for UUID: ${uuid}`);
      return { 
        success: true, 
        alreadyCancelled: true, 
        message: "Attendance already cancelled" 
      };
    }

    if (event.status !== AttendanceStatus.PENDING) {
      await transaction.rollbackTransaction();
      logger.warn(`[CANCEL] Invalid state: ${event.status} for UUID: ${uuid}`);
      return { 
        success: false, 
        invalidState: true, 
        status: event.status,
        message: `Attendance is in ${event.status} state and cannot be cancelled` 
      };
    }

    // 🎯 MARK AS CANCELLED
    logger.info(`[CANCEL] Marking as cancelled for UUID: ${uuid}`);
    // await event.update({
      event.status = AttendanceStatus.CANCELLED;
      event.confirmed_by = 'cancelled_by_user';
      event.confirmed_at = new Date();
      event.cancellation_reason = reason;
    await attendanceEvent.save(event);

    // 🎯 LAZY S3 UPLOAD: ONLY UPLOAD IMAGE IF CANCELLATION IS FOR PROXY DETECTION
    let s3ImageUrl = event.s3_image_url;
    if (!s3ImageUrl && reason === 'proxy_detected_by_user') {
      logger.info(`[CANCEL] Uploading image to S3 for proxy detection UUID: ${uuid}`);
      s3ImageUrl = await this.uploadImageIfNeeded(uuid);
    }

    const proxyEmployee = await employee.findOne({
      where: { employee_code: event.employee_code },
    });

    // 🎯 CREATE PROXY LOG
    logger.info(`[CANCEL] Creating proxy log for UUID: ${uuid}`);
    const proxyLog = ProxyLogs.create({
      id: uuidv4(),
      uuid: event.uuid,
      timestamp: new Date(),
      proxy_employee_code: event.employee_code,
      proxy_employee_name: proxyEmployee?.full_name || 'Unknown',
      actual_employee_code: actualEmployeeCode,
      actual_employee_name: actualEmployeeName,
      confidence: event.confidence ?? 0,
      s3_image_url: s3ImageUrl, // 🆕 USE THE UPLOADED S3 URL
      location_data: event.location_data,
      action: event.event_type,
      action_taken: 'cancelled_by_user',
      device_type: 'web',
      status: 'reported',
      reason: reason,
    });

    await ProxyLogs.save(proxyLog);
    await transaction.commitTransaction();

    logger.info(`[CANCEL] Successfully cancelled attendance for UUID: ${uuid}`);

    // 🎯 SEND EMAIL ONLY FOR PROXY DETECTION
    // let emailSent = false;
    // if (reason === 'proxy_detected_by_user') {
    //   logger.info(`[CANCEL] Triggering email for proxy detection - UUID: ${uuid}`);
    //   emailSent = await this.sendProxyAlertEmailBackgroundFromDB(proxyLog, actualEmployeeCode, actualEmployeeName);
    //   logger.info(`[CANCEL] Email sent result: ${emailSent} for UUID: ${uuid}`);
    // } else {
    //   logger.info(`[CANCEL] No email sent - reason: ${reason} for UUID: ${uuid}`);
    // }

    return { 
      success: true,
      proxyLog, 
      cancelledEvent: event,
      //emailSent,
      message: 'Attendance cancelled successfully'
    };

  } catch (error: any) {
    // 🆕 SAFE TRANSACTION CLEANUP
    if (transaction?.isTransactionActive) {
      try {
        // Attempt rollback; if the transaction is already committed/rolled back this may throw and will be caught
        await transaction.rollbackTransaction();
      } catch (rollbackErrorTransaction) {
        logger.error('Cancellation transaction rollback failed (or transaction already finalized):', rollbackErrorTransaction);
      }
    }
    
    // 🆕 SPECIFIC ERROR HANDLING FOR LOCK ISSUES
    if (error?.name === 'SequelizeTimeoutError') {
      logger.warn(`[CANCEL] Transaction timeout for UUID: ${uuid} - auto-confirm in progress`);
      throw new Error("System is processing this attendance. Please try again in a moment.");
    } else {
      logger.error('Cancel attendance transaction failed:', error);
      throw error;
    }
  }
}
// 🎯 HANDLE LATE CANCELLATION ATTEMPTS
// private static async sendLateCancellationEmail(proxyLog: any, actualEmployeeCode: string, actualEmployeeName: string): Promise<boolean> {
//   try {
//     const [proxyEmployee, actualEmployee] = await Promise.all([
//       Employee.findOne({ 
//         where: { employee_code: proxyLog.proxy_employee_code },
//         attributes: ['full_name', 'department'],
//         raw: true
//       }),
//       Employee.findOne({ 
//         where: { employee_code: actualEmployeeCode },
//         attributes: ['full_name', 'department'],
//         raw: true
//       })
//     ]);

//     const proxyData = {
//       uuid: proxyLog.uuid,
//       timestamp: proxyLog.timestamp || new Date(),
//       proxy_employee_code: proxyLog.proxy_employee_code,
//       proxy_employee_name: proxyEmployee?.full_name || proxyLog.proxy_employee_name || 'Unknown',
//       proxy_department: proxyEmployee?.department || 'Unknown',
//       actual_employee_code: actualEmployeeCode,
//       actual_employee_name: actualEmployeeName,
//       actual_department: actualEmployee?.department || 'Unknown',
//       confidence: proxyLog.confidence || 0,
//       action_taken: proxyLog.action_taken,
//       s3_image_url: proxyLog.s3_image_url || null,
//       location_data: proxyLog.location_data || null,
//       image_available: !!proxyLog.s3_image_url
//     };

//     const adminEmails = ["Sagar.b@bayanattechnology.com"];

//     const lateCancellationHtml = `
// <!DOCTYPE html>
// <html>
// <head>
//   <style>
//     body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
//     .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
//     .header { background: #ff9800; color: white; padding: 15px; text-align: center; border-radius: 8px 8px 0 0; }
//     .content { padding: 20px; background: #f9f9f9; }
//     .warning { background: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 10px 0; }
//   </style>
// </head>
// <body>
//   <div class="container">
//     <div class="header">
//       <h2>⚠️ LATE CANCELLATION ATTEMPT</h2>
//       <p>User tried to cancel after auto-confirmation</p>
//     </div>
    
//     <div class="content">
//       <div class="warning">
//         <h3>⚠️ Attention Required</h3>
//         <p><strong>This attendance was already auto-confirmed before the user could cancel it.</strong></p>
//         <p>The user attempted to report a proxy detection after the system had already confirmed the attendance.</p>
//       </div>
      
//       <div class="section">
//         <p><strong>UUID:</strong> ${proxyData.uuid}</p>
//         <p><strong>Timestamp:</strong> ${new Date(proxyData.timestamp).toLocaleString()}</p>
//         <p><strong>Action:</strong> ${proxyData.action_taken}</p>
//         <p><strong>Confidence Level:</strong> ${proxyData.confidence}%</p>
//       </div>

//       <div class="section">
//         <h3>👤 System-Recognized Employee</h3>
//         <p><strong>Employee Code:</strong> ${proxyData.proxy_employee_code}</p>
//         <p><strong>Name:</strong> ${proxyData.proxy_employee_name}</p>
//         <p><strong>Department:</strong> ${proxyData.proxy_department}</p>
//       </div>

//       <div class="section">
//         <h3>👥 Reporting Employee</h3>
//         <p><strong>Reported By:</strong> ${proxyData.actual_employee_name}</p>
//         <p><strong>Employee Code:</strong> ${proxyData.actual_employee_code}</p>
//       </div>

//       <div class="warning">
//         <h3>📋 Required Action</h3>
//         <p>Please manually review this attendance record and take appropriate action if this was indeed a proxy attempt.</p>
//         <p><strong>Current Status:</strong> Attendance remains CONFIRMED in the system.</p>
//       </div>
//     </div>
//   </div>
// </body>
// </html>
//     `;

//     await notifyUser({
//       event: constants.EVENTS.PROXY_ATTENDANCE_DETECTED,
//       request_user: proxyData, 
//       request_users: adminEmails.join(','), 
//       subject: `⚠️ LATE CANCELLATION ATTEMPT - ${proxyData.proxy_employee_name}`,
//       htmlMessage: lateCancellationHtml,
//       attachments: [] 
//     });

//     return true;
//   } catch (error) {
//     logger.error('Late cancellation email failed:', error);
//     return false;
//   }
// }

 // private static async sendProxyAlertEmailWithImage(data: any, actualEmployeeCode: string, actualEmployeeName: string, s3ImageUrl: string | null): Promise<boolean> {
//   try {
//     logger.info(`📧 [EMAIL] Starting proxy email for UUID: ${data.uuid}`);
    
//     let proxyEmployee: any = null;
//     let actualEmployee: any = null;
    
//     [proxyEmployee, actualEmployee] = await Promise.all([
//       Employee.findOne({ 
//         where: { employee_code: data.employee_code },
//         attributes: ['full_name', 'department', 'email'],
//         raw: true
//       }),
//       Employee.findOne({ 
//         where: { employee_code: actualEmployeeCode },
//         attributes: ['full_name', 'department', 'email'],
//         raw: true
//       })
//     ]);

//     const proxyData = {
//       uuid: data.uuid,
//       timestamp: data.timestamp,
//       proxy_employee_code: data.employee_code,
//       proxy_employee_name: proxyEmployee?.full_name || 'Unknown',
//       proxy_department: proxyEmployee?.department || 'Unknown',
//       proxy_email: proxyEmployee?.email || 'N/A',
//       actual_employee_code: actualEmployeeCode,
//       actual_employee_name: actualEmployeeName,
//       actual_department: actualEmployee?.department || 'Unknown',
//       actual_email: actualEmployee?.email || 'N/A',
//       confidence: data.confidence,
//       action_taken: 'cancelled_by_user',
//       s3_image_url: s3ImageUrl,
//       location_data: data.location_data,
//       image_available: !!s3ImageUrl,
//       event_type: data.action === "check-in" ? "Check In" : "Check Out"
//     };

//     const adminEmails = ["Sagar.b@bayanattechnology.com"];

//     logger.info(`📧 [EMAIL] Sending to: ${adminEmails.join(', ')}`);
//     logger.info(`📧 [EMAIL] Proxy data:`, {
//       proxy_name: proxyData.proxy_employee_name,
//       actual_name: proxyData.actual_employee_name,
//       confidence: proxyData.confidence,
//       has_image: !!s3ImageUrl
//     });

//     // 🆕 ENHANCED EMAIL SENDING WITH PROPER ERROR HANDLING
//     try {
//       const emailPromise = notifyUser({
//         event: constants.EVENTS.PROXY_ATTENDANCE_DETECTED,
//         request_user: proxyData, 
//         request_users: adminEmails.join(','), 
//         subject: `🚨 PROXY ATTENDANCE DETECTED - ${proxyData.proxy_employee_name} (${proxyData.proxy_employee_code})`,
//         message: `Proxy attendance detected and cancelled by user. Confidence: ${proxyData.confidence}%`,
//         attachments: [] 
//       });

//       // Add timeout to prevent hanging
//       const timeoutPromise = new Promise<boolean>((resolve) => 
//         setTimeout(() => {
//           logger.warn(`📧 [EMAIL] Email sending timeout for UUID: ${data.uuid}`);
//           resolve(false);
//         }, 10000) // 10 second timeout
//       );

//       const result = await Promise.race([emailPromise, timeoutPromise]);
      
//       if (result) {
//         logger.info(`✅ [EMAIL] Proxy email sent successfully for UUID: ${data.uuid}`);
//         return true;
//       } else {
//         logger.error(`❌ [EMAIL] Proxy email failed or timed out for UUID: ${data.uuid}`);
//         return false;
//       }
      
//     } catch (emailError) {
//       logger.error(`❌ [EMAIL] Proxy email exception for UUID: ${data.uuid}:`, emailError);
//       return false;
//     }

//   } catch (error) {
//     logger.error('❌ [EMAIL] Proxy email setup failed:', error);
//     return false;
//   }
// }

  // 🎯 BACKGROUND EMAIL SEND
  // private static async sendProxyAlertEmailBackgroundFromDB(proxyLog: any, actualEmployeeCode: string, actualEmployeeName: string): Promise<boolean> {
  //   try {
  //     const [proxyEmployee, actualEmployee] = await Promise.all([
  //       Employee.findOne({ 
  //         where: { employee_code: proxyLog.proxy_employee_code },
  //         attributes: ['full_name', 'department'],
  //         raw: true
  //       }),
  //       Employee.findOne({ 
  //         where: { employee_code: actualEmployeeCode },
  //         attributes: ['full_name', 'department'],
  //         raw: true
  //       })
  //     ]);

  //     const proxyData = {
  //       uuid: proxyLog.uuid,
  //       timestamp: proxyLog.timestamp || new Date(),
  //       proxy_employee_code: proxyLog.proxy_employee_code,
  //       proxy_employee_name: proxyEmployee?.full_name || proxyLog.proxy_employee_name || 'Unknown',
  //       proxy_department: proxyEmployee?.department || 'Unknown',
  //       actual_employee_code: actualEmployeeCode,
  //       actual_employee_name: actualEmployeeName,
  //       actual_department: actualEmployee?.department || 'Unknown',
  //       confidence: proxyLog.confidence || 0,
  //       action_taken: 'cancelled_by_user',
  //       s3_image_url: proxyLog.s3_image_url || null,
  //       location_data: proxyLog.location_data || null,
  //       image_available: !!proxyLog.s3_image_url
  //     };

  //     const adminEmails = ["Sagar.b@bayanattechnology.com"];

  //     await notifyUser({
  //       event: constants.EVENTS.PROXY_ATTENDANCE_DETECTED,
  //       request_user: proxyData, 
  //       request_users: adminEmails.join(','), 
  //       subject: `🚨 PROXY ATTENDANCE DETECTED - ${proxyData.proxy_employee_name}`,
  //       message: this.generateProxyEmailMessage(proxyData, actualEmployeeName, !!proxyLog.s3_image_url),
  //       attachments: [] 
  //     });

  //     return true;
  //   } catch (error) {
  //     logger.error('Background email failed:', error);
  //     return false;
  //   }
  // }

  // 🎯 GET EMPLOYEE IMAGE
  private static async getEmployeeImage(employeeId: string): Promise<string | null> {
    try {
      const cacheKey = `employee_face:${employeeId}`;
      let imageUrl = await this.cache.get(cacheKey);
      
      if (!imageUrl) {
        const employeeFaces = AppDataSource.getRepository(EmployeeFace);
        const employeeFace = await employeeFaces.findOne({
          where: { employee_id: employeeId, is_active: "1"},
          //raw: true
        });
        
        imageUrl = employeeFace ? await getSignedUrl(employeeFace.s3_key) : null;
        
        if (imageUrl) {
          await this.cache.set(cacheKey, imageUrl, CACHE_TTL);
        }
      }
      
      return imageUrl;
    } catch (error) {
      return null;
    }
  }

  // 🎯 FIXED CHECK IF UUID IS CANCELLED IN DATABASE
  private static async isCancelledInDatabase(uuid: string): Promise<boolean> {
    try {
      const attendanceEvents = AppDataSource.getRepository(AttendanceEvent);
      const event = await attendanceEvents.findOne({
        where: { uuid },
        select: ['status']
      });
      return event?.status === 'cancelled';
    } catch (error) {
      logger.error('Failed to check cancellation status in database:', error);
      return false;
    }
  }

  // 🎯 FIXED MARK AS CANCELLED IN DATABASE
  private static async markAsCancelledInDatabase(uuid: string): Promise<void> {
    try {
      const attendanceEvent =AppDataSource.getRepository(AttendanceEvent);
      const result = await attendanceEvent.update(
        { 
            uuid, 
            status: AttendanceStatus.PENDING
        },
        { 
          status: AttendanceStatus.CANCELLED,
          confirmed_by: 'cancelled_by_user',
          confirmed_at: new Date(),
          cancellation_reason: 'cancelled_by_user'
        },
        
      );
      
      if (result.affected && result.affected > 0) {
        logger.info(`✅ Marked as cancelled in database: ${uuid}`);
      }
    } catch (error) {
      logger.error('Failed to mark as cancelled in database:', error);
    }
  }

  // 🎯 CHECK IF AUTO-CONFIRM IS CANCELLED
  static isAutoConfirmCancelled(uuid: string): boolean {
    return this.cancelledConfirmations.has(uuid);
  }

  // 🎯 FIXED PROCESS AUTO-CONFIRM
  static async processAutoConfirm(): Promise<void> {
    const now = new Date();
    let memoryConfirmed = 0;
    let memoryCancelled = 0;
    let memorySkipped = 0;
    
    // Create a copy to avoid modification during iteration
    const pendingEntries = Array.from(this.pendingConfirmations.entries());
    
    for (const [uuid, data] of pendingEntries) {
      if (data.auto_confirm_time <= now) {
        try {
          // Skip if already cancelled in memory
          if (data.is_cancelled || this.isAutoConfirmCancelled(uuid)) {
            this.pendingConfirmations.delete(uuid);
            memoryCancelled++;
            continue;
          }

          // Process auto-confirm with enhanced checks
          await this.autoConfirmFromMemory(uuid);
          memoryConfirmed++;
          
        } catch (error) {
          logger.error(`[AUTO-CONFIRM] Failed for ${uuid}:`, error);
          memorySkipped++;
        }
      }
    }

    if (memoryConfirmed > 0 || memoryCancelled > 0 || memorySkipped > 0) {
      logger.info(`[AUTO-CONFIRM] Completed: ${memoryConfirmed} confirmed, ${memoryCancelled} cancelled, ${memorySkipped} skipped`);
    }
  }

  // 🎯 GET PROXY LOGS
  static async getProxyLogs(filters: any = {}): Promise<any> {
    const { page = 1, limit = 50, start_date, end_date, employee_code } = filters;
    
    const cacheKey = `proxy_logs:${page}:${limit}:${start_date}:${end_date}:${employee_code}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const offset = (page - 1) * limit;
    const whereClause: any = {};

    if (start_date && end_date) {
      whereClause.timestamp = Between(new Date(start_date), new Date(end_date));
    }

    const AttendanceLog = AppDataSource.getRepository(ProxyLog)
    const [ rows, count ]  = await AttendanceLog.findAndCount({
      where: whereClause,
      order: {timestamp: 'DESC'},
      skip: offset,
      take: parseInt(limit)
    });

    const result = {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(count / limit),
      proxy_logs: rows
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  // 🎯 GET ATTENDANCE REPORT
  static async getAttendanceReport(
    startDate: Date,
    endDate: Date,
    department?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const skip = (page - 1) * limit;

    const adjustedStartDate = new Date(startDate);
    adjustedStartDate.setHours(0, 0, 0, 0);

    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    const eventWhereClause: any = {
      event_time:  Between(adjustedStartDate, adjustedEndDate) ,
      status:  In(['confirmed','pending_auto_confirm']),
    };

    let employeeWhereClause = {};
    if (department) employeeWhereClause = { department };

    const AttendanceReport = AppDataSource.getRepository(AttendanceEvent)
    const [ rows, count ]  = await AttendanceReport.findAndCount({
      where: eventWhereClause,
      relations: 
        {
          employee: true,
          record: true,
        },
      order: {"event_time": "DESC"},
      skip,
      take: limit,
    });

    const formattedData = rows.map((event: any) => {
      const eventTime = new Date(event.event_time);
      const eventDate = new Date(eventTime);
      eventDate.setHours(0, 0, 0, 0);

      return {
        event_id: event.id,
        event_type: event.event_type,
        event_time: event.event_time,
        employee_id: event.employee_id,
        employee_code: event.employee_code,
        full_name: event.employee?.full_name,
        department: event.employee?.department,
        position: event.employee?.position,
        date: eventDate.toISOString().split("T")[0], 
        daily_status: event.record?.status,
        total_hours: event.record?.total_hours,
        time_only: eventTime.toTimeString().split(" ")[0], 
        day_of_week: eventTime.toLocaleDateString("en-US", { weekday: "long" }),
      };
    });

    return { total: count, page, limit, data: formattedData };
  }

  // 🎯 HELPER METHODS
  private static calculateStatus(time: Date, startTime: string): "present" | "late" | "half-day" {
    const [hours, minutes] = startTime.split(":").map(Number);
    const lateThreshold = new Date(time);
    lateThreshold.setHours(hours, minutes, 0, 0);
    return time > lateThreshold ? "late" : "present";
  }

  private static generateProxyEmailMessage(proxyData: any, actualEmployeeName: string, hasImage: boolean): string {
    return `
🚨 PROXY ATTENDANCE DETECTION ALERT

System detected a potential proxy attendance attempt:

📋 ATTENDANCE DETAILS:
• Recognized Employee: ${proxyData.proxy_employee_name} (${proxyData.proxy_employee_code})
• Department: ${proxyData.proxy_department}
• Reported By: ${actualEmployeeName} (${proxyData.actual_employee_code})
• Confidence Score: ${proxyData.confidence}%
• Action: ${proxyData.action_taken}
• Timestamp: ${new Date(proxyData.timestamp).toLocaleString()}
• UUID: ${proxyData.uuid}

📍 LOCATION DATA:
${proxyData.location_data ? 
  `• Type: ${proxyData.location_data.location_type || 'N/A'}
• Office: ${proxyData.location_data.office_name || 'N/A'}
• Address: ${proxyData.location_data.address || 'N/A'}
• Coordinates: ${proxyData.location_data.latitude || 'N/A'}, ${proxyData.location_data.longitude || 'N/A'}
• Accuracy: ${proxyData.location_data.accuracy || 'N/A'} meters` : 
  '• Location data not available'}

📸 CAPTURED IMAGE:
${hasImage ? 
  `✅ Image available for review` : 
  '❌ No image available for this attendance'}

⚠️ ACTION REQUIRED:
Please review this attendance record and take appropriate action.

This is an automated alert from the Smart Attendance System.
    `;
  }

  // 🎯 MONITORING
  static getPerformanceMetrics() {
    return {
      pendingConfirmations: this.pendingConfirmations.size,
      cancelledConfirmations: this.cancelledConfirmations.size,
      concurrentRequests: this.concurrentRequests,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      faceServiceReady: !!this.faceService
    };
  }

  // 🎯 CLEANUP
  static async cleanupOldData(): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      let cleanedCount = 0;
      let bufferCleanedCount = 0;
      
      for (const [uuid, data] of this.pendingConfirmations.entries()) {
        if (data.timestamp < oneHourAgo) {
          // Clear any pending timers
          if (data.autoConfirmTimer) {
            clearTimeout(data.autoConfirmTimer);
          }
          
          // 🆕 CLEAN UP IMAGE BUFFER TO SAVE MEMORY
          if (data.image_buffer) {
            data.image_buffer = null;
            bufferCleanedCount++;
          }
          
          this.pendingConfirmations.delete(uuid);
          cleanedCount++;
        }
      }

      const cancelledArray = Array.from(this.cancelledConfirmations);
      const oldCancelled = cancelledArray.filter(uuid => {
        const data = this.pendingConfirmations.get(uuid);
        return !data || data.timestamp < oneHourAgo;
      });
      
      oldCancelled.forEach(uuid => this.cancelledConfirmations.delete(uuid));

      logger.info(`Cleanup completed. Removed ${cleanedCount} old pending confirmations, cleaned ${bufferCleanedCount} image buffers, and ${oldCancelled.length} old cancelled confirmations.`);
    } catch (error) {
      logger.error('Cleanup failed:', error);
    }
  }

  // 🎯 GET PENDING CONFIRMATIONS COUNT
  static getPendingConfirmationsCount(): number {
    return this.pendingConfirmations.size;
  }
  
  // 🎯 CHECK IF UUID IS PENDING IN MEMORY
  static isPendingInMemory(uuid: string): boolean {
    return this.pendingConfirmations.has(uuid);
  }
  
  // 🎯 GET CANCELLED CONFIRMATIONS COUNT
  static getCancelledConfirmationsCount(): number {
    return this.cancelledConfirmations.size;
  }

  // 🎯 GET PENDING CONFIRMATION DATA
  static getPendingConfirmation(uuid: string): any {
    return this.pendingConfirmations.get(uuid);
  }

  // 🎯 FORCE CANCEL ALL PENDING (FOR TESTING/ADMIN)
  static async forceCancelAllPending(): Promise<number> {
    let cancelledCount = 0;
    const uuids = Array.from(this.pendingConfirmations.keys());
    
    for (const uuid of uuids) {
      try {
        this.stopAutoConfirm(uuid);
        cancelledCount++;
      } catch (error) {
        logger.error(`Force cancel failed for ${uuid}:`, error);
      }
    }
    
    logger.info(`Force cancelled ${cancelledCount} pending confirmations`);
    return cancelledCount;
  }
}

// 🚀 INITIALIZE SERVICE ON STARTUP
AttendanceService.initializeFaceService().catch(err => {
  logger.error('Failed to initialize face service:', err);
});

// 🚀 REGULAR CLEANUP EVERY 30 MINUTES (more frequent to save memory)
setInterval(() => {
  AttendanceService.cleanupOldData();
}, 30 * 60 * 1000);

// 🚀 REGULAR AUTO-CONFIRM PROCESSING EVERY 30 SECONDS
setInterval(() => {
  AttendanceService.processAutoConfirm();
}, 30000);