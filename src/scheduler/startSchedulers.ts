import { AttendanceEventScheduler } from "../services/Attendance/attendanceEventScheduler.service";

export async function startSchedulers(): Promise<void> {
  // Allow disabling schedulers via env var SCHEDULER_ENABLED=false
  const enabled = process.env.SCHEDULER_ENABLED;
  if (enabled && enabled.toLowerCase() === "false") {
    console.log("Schedulers are disabled by SCHEDULER_ENABLED=false");
    return;
  }

  try {
    console.log("Starting schedulers...");

    AttendanceEventScheduler.initializeScheduler();
    console.log("✅ AttendanceEventScheduler initialized");
    console.log("All schedulers started");
  } catch (error) {
    console.error("Failed to start schedulers:", error);
    throw error;
  }
}

export default startSchedulers;