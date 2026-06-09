import { startNotificationEmailScheduler } from "./notificationEmail.scheduler";

export async function startSchedulers(): Promise<void> {
  const enabled = process.env.SCHEDULER_ENABLED;
  if (enabled && enabled.toLowerCase() === "false") {
    console.log("Schedulers are disabled by SCHEDULER_ENABLED=false");
    return;
  }

  try {
    console.log("Starting schedulers...");
    startNotificationEmailScheduler();
    console.log("NotificationEmailScheduler initialized");
    console.log("All schedulers started");
  } catch (error) {
    console.error("Failed to start schedulers:", error);
    throw error;
  }
}

export default startSchedulers;