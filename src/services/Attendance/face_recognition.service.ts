// // import * as tf from "@tensorflow/tfjs";
// // import "@tensorflow/tfjs-node";
// // import * as faceapi from "face-api.js";
// // import { createCanvas, Image, ImageData } from "canvas";
// // import sharp from "sharp";
// // import logger from "../../utils/logger";
// // import constants from "../../helpers/constants";
// // import EmployeeFace from "../../models/Attendance/employee_face";
// // import path from "path";
// // import fs from "fs";
// // import fetch from "node-fetch";

// // // Cache for better performance
// // let canvas: any = null;
// // let isSetup = false;
// // let faceMatcher: faceapi.FaceMatcher | null = null;
// // let faceMatcherLastUpdate: number = 0;
// // const FACE_MATCHER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// // const setupFaceAPI = () => {
// //   if (isSetup) return;

// //   canvas = createCanvas(1, 1);
// //   faceapi.env.monkeyPatch({
// //     Canvas: canvas.constructor as any,
// //     Image: Image as any,
// //     ImageData: ImageData as any,
// //   });

// //   isSetup = true;
// // };

// // class FaceApiResponse implements Response {
// //   constructor(private nodeFetchResponse: any) {}

// //   get ok() {
// //     return this.nodeFetchResponse.ok;
// //   }
// //   get status() {
// //     return this.nodeFetchResponse.status;
// //   }
// //   get statusText() {
// //     return this.nodeFetchResponse.statusText;
// //   }
// //   get url() {
// //     return this.nodeFetchResponse.url;
// //   }
// //   get headers() {
// //     return {
// //       get: (name: string) => this.nodeFetchResponse.headers.get(name),
// //       has: (name: string) => this.nodeFetchResponse.headers.has(name),
// //       entries: () => this.nodeFetchResponse.headers.entries(),
// //       [Symbol.iterator]: () =>
// //         this.nodeFetchResponse.headers[Symbol.iterator](),
// //       getSetCookie: () => [],
// //     } as unknown as Headers;
// //   }
// //   get body() {
// //     return this.nodeFetchResponse.body;
// //   }
// //   get bodyUsed() {
// //     return this.nodeFetchResponse.bodyUsed;
// //   }
// //   get type() {
// //     return "basic" as ResponseType;
// //   }
// //   get redirected() {
// //     return false;
// //   }

// //   arrayBuffer() {
// //     return this.nodeFetchResponse.arrayBuffer();
// //   }
// //   text() {
// //     return this.nodeFetchResponse.text();
// //   }
// //   json() {
// //     return this.nodeFetchResponse.json();
// //   }
// //   blob() {
// //     return Promise.reject(new Error("Blob not implemented"));
// //   }
// //   formData() {
// //     return Promise.reject(new Error("FormData not implemented"));
// //   }
// //   clone() {
// //     return new FaceApiResponse(this.nodeFetchResponse.clone());
// //   }

// //   bytes(): Promise<Uint8Array<ArrayBuffer>> {
// //     return this.arrayBuffer().then((buf: ArrayBuffer) => new Uint8Array(buf));
// //   }
// // }

// // export class FaceRecognitionService {
// //   private static instance: FaceRecognitionService;
// //   private static isInitialized = false;
// //   private modelsLoaded = false;

// //   // Optimized detection options
// //   private readonly faceDetectionOptions = new faceapi.SsdMobilenetv1Options({
// //     minConfidence: 0.4,
// //     maxResults: 1,
// //   });

// //   // Tiny Face Detector for faster processing
// //   private readonly tinyFaceDetectorOptions =
// //     new faceapi.TinyFaceDetectorOptions({
// //       inputSize: 160,
// //       scoreThreshold: 0.4,
// //     });

// //   private static readonly MATCH_THRESHOLD = 0.6;
// //   private static readonly OPTIMIZED_IMAGE_SIZE = 480;

// //   private constructor() {
// //     logger.info("FaceRecognitionService instance created");
// //   }

// //   public static async getInstance(): Promise<FaceRecognitionService> {
// //     if (!FaceRecognitionService.instance) {
// //       setupFaceAPI();
// //       FaceRecognitionService.instance = new FaceRecognitionService();
// //       await FaceRecognitionService.initialize();
// //     }
// //     return FaceRecognitionService.instance;
// //   }

// //   private static async initialize(): Promise<void> {
// //     if (FaceRecognitionService.isInitialized) return;

// //     try {
// //       await this.initializeTensorFlow();
// //       const instance = FaceRecognitionService.instance;
// //       await instance.loadModels();
// //       FaceRecognitionService.isInitialized = true;
// //       logger.info(
// //         "FaceRecognitionService initialized successfully with TensorFlow.js Node backend"
// //       );
// //     } catch (error) {
// //       logger.error("Initialization failed", error);
// //       throw error;
// //     }
// //   }

// //   private static async initializeTensorFlow(): Promise<void> {
// //     // Use TensorFlow.js Node backend for massive performance improvement
// //     if (!tf.getBackend()) {
// //       try {
// //         // This will use the Node.js backend automatically since we imported '@tensorflow/tfjs-node'
// //         await tf.ready();
// //         logger.info(`TensorFlow.js backend: ${tf.getBackend()}`);
// //       } catch (error) {
// //         logger.warn(
// //           "Failed to initialize TensorFlow.js Node backend, falling back to CPU",
// //           error
// //         );
// //         await tf.setBackend("cpu");
// //         await tf.ready();
// //       }
// //     }

// //     if (!(faceapi.tf as any).platform) {
// //       faceapi.tf.setPlatform("node", {
// //         fetch: async (path: string) => {
// //           const response = await fetch(path);
// //           return new FaceApiResponse(response);
// //         },
// //         now: () => Date.now(),
// //         encode: (text: string) => new TextEncoder().encode(text),
// //         decode: (bytes: Uint8Array) => new TextDecoder().decode(bytes),
// //       });
// //     }
// //   }

// //   private async loadModels(): Promise<void> {
// //     if (this.modelsLoaded) return;

// //     try {
// //       logger.info("Loading face recognition models...");

// //       const modelPath = path.join(__dirname, "../../../models");
// //       if (!fs.existsSync(modelPath)) {
// //         throw new Error(`Model path not found: ${modelPath}`);
// //       }

// //       // Load ALL required models including FaceLandmark68Net
// //       await Promise.all([
// //         faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath),
// //         faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath), // REQUIRED for withFaceLandmarks()
// //         faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath),
// //         faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath), // Load tiny face detector model
// //       ]);

// //       this.modelsLoaded = true;
// //       logger.info("Face recognition models loaded successfully");
// //     } catch (error) {
// //       logger.error("Model loading failed", error);
// //       throw error;
// //     }
// //   }

// //   // Optimized face descriptor extraction with error handling
// //   public async extractFaceDescriptor(imageBuffer: Buffer): Promise<number[]> {
// //     try {
// //       const processedImage = await this.preprocessImage(imageBuffer);
// //       const img = new Image();
// //       img.src = processedImage;

// //       const input = faceapi.createCanvasFromMedia(img as any);

// //       let detections;

// //       // Try primary detector first
// //       try {
// //         detections = await faceapi
// //           .detectAllFaces(input, this.faceDetectionOptions)
// //           .withFaceLandmarks()
// //           .withFaceDescriptors();
// //       } catch (error) {
// //         logger.warn(
// //           "Primary detector failed, trying tiny face detector",
// //           error
// //         );
// //         // Fallback to tiny face detector
// //         detections = await faceapi
// //           .detectAllFaces(input, this.tinyFaceDetectorOptions)
// //           .withFaceLandmarks()
// //           .withFaceDescriptors();
// //       }

// //       if (detections.length === 0) {
// //         throw new Error("No face detected in the image");
// //       }

// //       if (detections.length > 1) {
// //         // Use the face with highest confidence
// //         const bestDetection = detections.reduce((prev, current) =>
// //           prev.detection.score > current.detection.score ? prev : current
// //         );
// //         logger.warn(
// //           `Multiple faces detected, using highest confidence face: ${bestDetection.detection.score}`
// //         );
// //         return Array.from(bestDetection.descriptor);
// //       }

// //       return Array.from(detections[0].descriptor);
// //     } catch (error) {
// //       logger.error("Face descriptor extraction failed:", error);
// //       throw error;
// //     }
// //   }

// //   // Alternative method without landmarks (faster but less accurate)
// //   public async extractFaceDescriptorFast(
// //     imageBuffer: Buffer
// //   ): Promise<number[]> {
// //     try {
// //       const processedImage = await this.preprocessImage(imageBuffer);
// //       const img = new Image();
// //       img.src = processedImage;

// //       const input = faceapi.createCanvasFromMedia(img as any);

// //       // Use tiny face detector without landmarks for maximum speed
// //       const detections = await faceapi
// //         .detectAllFaces(input, this.tinyFaceDetectorOptions)
// //         .withFaceLandmarks()
// //         .withFaceDescriptors();

// //       if (detections.length === 0) {
// //         throw new Error("No face detected in the image");
// //       }

// //       if (detections.length > 1) {
// //         const bestDetection = detections.reduce((prev, current) =>
// //           prev.detection.score > current.detection.score ? prev : current
// //         );
// //         return Array.from(bestDetection.descriptor);
// //       }

// //       return Array.from(detections[0].descriptor);
// //     } catch (error) {
// //       logger.error("Fast face descriptor extraction failed:", error);
// //       // Fallback to accurate method
// //       return this.extractFaceDescriptor(imageBuffer);
// //     }
// //   }

// //   // Faster image preprocessing
// //   private async preprocessImage(imageBuffer: Buffer): Promise<Buffer> {
// //     try {
// //       const metadata = await sharp(imageBuffer).metadata();

// //       // Only resize if image is larger than our target
// //       let resizeWidth = FaceRecognitionService.OPTIMIZED_IMAGE_SIZE;
// //       if (metadata.width && metadata.width < resizeWidth) {
// //         resizeWidth = metadata.width;
// //       }

// //       return await sharp(imageBuffer)
// //         .rotate()
// //         .resize(resizeWidth, resizeWidth, {
// //           fit: "cover",
// //           withoutEnlargement: true,
// //           fastShrinkOnLoad: true,
// //         })
// //         .jpeg({ quality: 80, mozjpeg: true })
// //         .toBuffer();
// //     } catch (error) {
// //       logger.error("Image preprocessing failed", error);
// //       throw error;
// //     }
// //   }

// //   // Cached face matcher for faster matching
// //   private async getCachedFaceMatcher(): Promise<faceapi.FaceMatcher> {
// //     const now = Date.now();

// //     if (faceMatcher && now - faceMatcherLastUpdate < FACE_MATCHER_CACHE_TTL) {
// //       return faceMatcher;
// //     }

// //     const activeFaces = await EmployeeFace.findAll({
// //       where: { is_active: true },
// //       attributes: ["employee_id", "descriptor"],
// //     });

// //     if (activeFaces.length === 0) {
// //       throw new Error("No registered faces found in database");
// //     }

// //     const labeledDescriptors = activeFaces.map((face) => {
// //       let descriptorArray: number[] = Array.isArray(face.descriptor)
// //         ? face.descriptor
// //         : typeof face.descriptor === "string"
// //         ? JSON.parse(face.descriptor)
// //         : Object.values(face.descriptor as object);

// //       return new faceapi.LabeledFaceDescriptors(face.employee_id, [
// //         new Float32Array(descriptorArray),
// //       ]);
// //     });

// //     faceMatcher = new faceapi.FaceMatcher(
// //       labeledDescriptors,
// //       FaceRecognitionService.MATCH_THRESHOLD
// //     );
// //     faceMatcherLastUpdate = now;

// //     logger.info(
// //       `Face matcher cache updated with ${labeledDescriptors.length} employees`
// //     );
// //     return faceMatcher;
// //   }

// //   // Optimized matching with caching
// //   public async findBestMatch(
// //     descriptor: number[],
// //     minConfidence = constants.FACE_RECOGNITION.MIN_CONFIDENCE
// //   ): Promise<{ employeeId: string; confidence: number } | null> {
// //     try {
// //       const faceMatcher = await this.getCachedFaceMatcher();
// //       const bestMatch = faceMatcher.findBestMatch(new Float32Array(descriptor));

// //       if (
// //         bestMatch.distance < FaceRecognitionService.MATCH_THRESHOLD &&
// //         bestMatch.label !== "unknown"
// //       ) {
// //         const confidence = 1 - bestMatch.distance;
// //         if (confidence >= minConfidence) {
// //           return {
// //             employeeId: bestMatch.label,
// //             confidence: confidence,
// //           };
// //         }
// //       }

// //       logger.warn(
// //         `No confident match found. Best distance: ${bestMatch.distance}, Label: ${bestMatch.label}`
// //       );
// //       return null;
// //     } catch (error) {
// //       logger.error("Face matching failed", error);
// //       throw error;
// //     }
// //   }

// //   // Method to manually clear cache when new faces are added
// //   public clearFaceMatcherCache(): void {
// //     faceMatcher = null;
// //     faceMatcherLastUpdate = 0;
// //     logger.info("Face matcher cache cleared");
// //   }

// //   // Utility method to check backend information
// //   public getBackendInfo(): string {
// //     return `TensorFlow.js backend: ${tf.getBackend()}`;
// //   }
// // }

// // export const getFaceRecognitionService = () =>
// //   FaceRecognitionService.getInstance();
// // export default getFaceRecognitionService;

// import * as tf from "@tensorflow/tfjs";
// import * as faceapi from "face-api.js";
// import { createCanvas, Image, ImageData } from "canvas";
// import sharp from "sharp";
// import logger from "../../utils/logger";
// import constants from "../../helpers/constants";
// import EmployeeFace from "../../models/Attendance/employee_face";
// import path from "path";
// import fs from "fs";
// import fetch from "node-fetch";

// // Cache for maximum performance
// let canvas: any = null;
// let isSetup = false;
// let faceMatcher: faceapi.FaceMatcher | null = null;
// let faceMatcherLastUpdate: number = 0;
// const FACE_MATCHER_CACHE_TTL = 10 * 60 * 1000;

// // Performance monitoring
// let performanceStats = {
//   totalProcesses: 0,
//   totalTime: 0,
//   averageTime: 0,
// };

// const setupFaceAPI = () => {
//   if (isSetup) return;

//   canvas = createCanvas(1, 1);
//   faceapi.env.monkeyPatch({
//     Canvas: canvas.constructor as any,
//     Image: Image as any,
//     ImageData: ImageData as any,
//   });

//   isSetup = true;
// };

// class FaceApiResponse implements Response {
//   constructor(private nodeFetchResponse: any) {}

//   get ok() {
//     return this.nodeFetchResponse.ok;
//   }
//   get status() {
//     return this.nodeFetchResponse.status;
//   }
//   get statusText() {
//     return this.nodeFetchResponse.statusText;
//   }
//   get url() {
//     return this.nodeFetchResponse.url;
//   }
//   get headers() {
//     return {
//       get: (name: string) => this.nodeFetchResponse.headers.get(name),
//       has: (name: string) => this.nodeFetchResponse.headers.has(name),
//       entries: () => this.nodeFetchResponse.headers.entries(),
//       [Symbol.iterator]: () =>
//         this.nodeFetchResponse.headers[Symbol.iterator](),
//       getSetCookie: () => [],
//     } as unknown as Headers;
//   }
//   get body() {
//     return this.nodeFetchResponse.body;
//   }
//   get bodyUsed() {
//     return this.nodeFetchResponse.bodyUsed;
//   }
//   get type() {
//     return "basic" as ResponseType;
//   }
//   get redirected() {
//     return false;
//   }

//   arrayBuffer() {
//     return this.nodeFetchResponse.arrayBuffer();
//   }
//   text() {
//     return this.nodeFetchResponse.text();
//   }
//   json() {
//     return this.nodeFetchResponse.json();
//   }
//   blob() {
//     return Promise.reject(new Error("Blob not implemented"));
//   }
//   formData() {
//     return Promise.reject(new Error("FormData not implemented"));
//   }
//   clone() {
//     return new FaceApiResponse(this.nodeFetchResponse.clone());
//   }

//   bytes(): Promise<Uint8Array<ArrayBuffer>> {
//     return this.arrayBuffer().then((buf: ArrayBuffer) => new Uint8Array(buf));
//   }
// }

// export class FaceRecognitionService {
//   private static instance: FaceRecognitionService;
//   private static isInitialized = false;
//   private modelsLoaded = false;

//   // **OPTIMIZED DETECTION OPTIONS FOR SPEED**
//   private readonly tinyFaceDetectorOptions =
//     new faceapi.TinyFaceDetectorOptions({
//       inputSize: 128, // Smaller = faster (was 160)
//       scoreThreshold: 0.3, // Lower threshold for faster detection
//     });

//   // **FASTER MATCHING THRESHOLD**
//   private static readonly MATCH_THRESHOLD = 0.55;
//   private static readonly OPTIMIZED_IMAGE_SIZE = 224; // Reduced from 480 for speed

//   private constructor() {
//     logger.info(
//       "FaceRecognitionService instance created with performance optimizations"
//     );
//   }

//   public static async getInstance(): Promise<FaceRecognitionService> {
//     if (!FaceRecognitionService.instance) {
//       setupFaceAPI();
//       FaceRecognitionService.instance = new FaceRecognitionService();
//       await FaceRecognitionService.initialize();
//     }
//     return FaceRecognitionService.instance;
//   }

//   private static async initialize(): Promise<void> {
//     if (FaceRecognitionService.isInitialized) return;

//     try {
//       await this.initializeTensorFlow();
//       const instance = FaceRecognitionService.instance;
//       await instance.loadModels();
//       FaceRecognitionService.isInitialized = true;
//       logger.info("FaceRecognitionService initialized successfully");
//     } catch (error) {
//       logger.error("Initialization failed", error);
//       throw error;
//     }
//   }

//   private static async initializeTensorFlow(): Promise<void> {
//     try {
//       // Use CPU backend for maximum compatibility
//       if (!tf.getBackend()) {
//         await tf.setBackend("cpu");
//         await tf.ready();
//       }

//       // Enable production mode for better performance
//       tf.enableProdMode();

//       logger.info(`TensorFlow.js backend initialized: ${tf.getBackend()}`);

//       if (!(faceapi.tf as any).platform) {
//         faceapi.tf.setPlatform("node", {
//           fetch: async (path: string) => {
//             const response = await fetch(path);
//             return new FaceApiResponse(response);
//           },
//           now: () => Date.now(),
//           encode: (text: string) => new TextEncoder().encode(text),
//           decode: (bytes: Uint8Array) => new TextDecoder().decode(bytes),
//         });
//       }
//     } catch (error) {
//       logger.error("TensorFlow initialization failed", error);
//       throw error;
//     }
//   }

//   private async loadModels(): Promise<void> {
//     if (this.modelsLoaded) return;

//     try {
//       logger.info("Loading optimized face recognition models...");

//       const modelPath = path.join(__dirname, "../../../models");
//       if (!fs.existsSync(modelPath)) {
//         throw new Error(`Model path not found: ${modelPath}`);
//       }

//       // **LOAD ONLY ESSENTIAL MODELS FOR SPEED**
//       await Promise.all([
//         faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath), // Fastest detector
//         faceapi.nets.faceLandmark68TinyNet.loadFromDisk(modelPath), // Use TINY landmarks for speed
//         faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath),
//       ]);

//       this.modelsLoaded = true;
//       logger.info("Optimized face recognition models loaded successfully");
//     } catch (error) {
//       logger.error("Model loading failed", error);
//       throw error;
//     }
//   }

//   // **HIGH-SPEED face descriptor extraction**
//   public async extractFaceDescriptor(imageBuffer: Buffer): Promise<number[]> {
//     const startTime = Date.now();

//     try {
//       // **FAST PREPROCESSING**
//       const processedImage = await this.fastPreprocessImage(imageBuffer);

//       const img = new Image();
//       img.src = processedImage;

//       const input = faceapi.createCanvasFromMedia(img as any);

//       // **USE TINY FACE DETECTOR + TINY LANDMARKS FOR MAXIMUM SPEED**
//       const detections = await faceapi
//         .detectAllFaces(input, this.tinyFaceDetectorOptions)
//         .withFaceLandmarks(true) // true = use tiny landmarks (68TinyNet)
//         .withFaceDescriptors();

//       if (detections.length === 0) {
//         throw new Error("No face detected in the image");
//       }

//       if (detections.length > 1) {
//         // Quick selection - no complex reduction for speed
//         const bestDetection = detections[0]; // Just take first detection for speed
//         logger.warn(
//           `Multiple faces detected, using first face: ${bestDetection.detection.score}`
//         );
//         return Array.from(bestDetection.descriptor);
//       }

//       const processingTime = Date.now() - startTime;
//       this.updatePerformanceStats(processingTime);

//       logger.info(`Face descriptor extracted in ${processingTime}ms`);
//       return Array.from(detections[0].descriptor);
//     } catch (error) {
//       logger.error("Face descriptor extraction failed:", error);
//       throw error;
//     }
//   }

//   // **ULTRA-FAST image preprocessing**
//   private async fastPreprocessImage(imageBuffer: Buffer): Promise<Buffer> {
//     try {
//       return await sharp(imageBuffer)
//         .rotate() // Auto-rotate based on EXIF
//         .resize(224, 224, {
//           // Smaller size for speed
//           fit: "cover",
//           withoutEnlargement: true,
//           fastShrinkOnLoad: true,
//         })
//         .jpeg({
//           quality: 70, // Lower quality for speed
//           mozjpeg: true,
//         })
//         .toBuffer();
//     } catch (error) {
//       logger.error("Image preprocessing failed", error);
//       throw error;
//     }
//   }

//   // **OPTIMIZED cached face matcher**
//   private async getCachedFaceMatcher(): Promise<faceapi.FaceMatcher> {
//     const now = Date.now();

//     if (faceMatcher && now - faceMatcherLastUpdate < FACE_MATCHER_CACHE_TTL) {
//       return faceMatcher;
//     }

//     const activeFaces = await EmployeeFace.findAll({
//       where: { is_active: true },
//       attributes: ["employee_id", "descriptor"],
//       raw: true, // Faster database query
//     });

//     if (activeFaces.length === 0) {
//       throw new Error("No registered faces found in database");
//     }

//     const labeledDescriptors = activeFaces.map((face :any) => {
//       let descriptorArray: number[];

//       if (Array.isArray(face.descriptor)) {
//         descriptorArray = face.descriptor;
//       } else if (typeof face.descriptor === "string") {
//         descriptorArray = JSON.parse(face.descriptor);
//       } else {
//         descriptorArray = Object.values(face.descriptor as object);
//       }

//       return new faceapi.LabeledFaceDescriptors(face.employee_id, [
//         new Float32Array(descriptorArray),
//       ]);
//     });

//     faceMatcher = new faceapi.FaceMatcher(
//       labeledDescriptors,
//       FaceRecognitionService.MATCH_THRESHOLD
//     );
//     faceMatcherLastUpdate = now;

//     logger.info(
//       `Face matcher cache updated with ${labeledDescriptors.length} employees`
//     );
//     return faceMatcher;
//   }

//   // **HIGH-PERFORMANCE matching**
//   public async findBestMatch(
//     descriptor: number[]
//   ): Promise<{ employeeId: string; confidence: number } | null> {
//     const startTime = Date.now();

//     try {
//       const faceMatcher = await this.getCachedFaceMatcher();
//       const bestMatch = faceMatcher.findBestMatch(new Float32Array(descriptor));

//       const confidence = (1 - bestMatch.distance) * 100;
//       const matchingTime = Date.now() - startTime;

//       if (
//         bestMatch.distance <= FaceRecognitionService.MATCH_THRESHOLD &&
//         bestMatch.label !== "unknown"
//       ) {
//         logger.info(
//           `Match found: ${
//             bestMatch.label
//           } in ${matchingTime}ms (${confidence.toFixed(1)}% confidence)`
//         );
//         return {
//           employeeId: bestMatch.label,
//           confidence: confidence,
//         };
//       }

//       logger.warn(
//         `No match found in ${matchingTime}ms. Distance: ${bestMatch.distance.toFixed(
//           3
//         )}`
//       );
//       return null;
//     } catch (error) {
//       logger.error("Face matching failed", error);
//       throw error;
//     }
//   }

//   // **Performance monitoring**
//   private updatePerformanceStats(processingTime: number): void {
//     performanceStats.totalProcesses++;
//     performanceStats.totalTime += processingTime;
//     performanceStats.averageTime =
//       performanceStats.totalTime / performanceStats.totalProcesses;

//     // Log performance every 10 processes
//     if (performanceStats.totalProcesses % 10 === 0) {
//       logger.info(
//         `Performance stats - Avg: ${performanceStats.averageTime.toFixed(
//           0
//         )}ms, Total: ${performanceStats.totalProcesses}`
//       );
//     }
//   }

//   // **Get performance statistics**
//   public getPerformanceStats() {
//     return { ...performanceStats };
//   }

//   // **Quick face detection only (for verification)**
//   public async quickFaceCheck(imageBuffer: Buffer): Promise<boolean> {
//     try {
//       const processedImage = await this.fastPreprocessImage(imageBuffer);
//       const img = new Image();
//       img.src = processedImage;
//       const input = faceapi.createCanvasFromMedia(img as any);

//       const detections = await faceapi.detectAllFaces(
//         input,
//         this.tinyFaceDetectorOptions
//       );
//       return detections.length > 0;
//     } catch (error) {
//       return false;
//     }
//   }

//   public clearFaceMatcherCache(): void {
//     faceMatcher = null;
//     faceMatcherLastUpdate = 0;
//     logger.info("Face matcher cache cleared");
//   }
// }

// export const getFaceRecognitionService = () =>
//   FaceRecognitionService.getInstance();
// export default getFaceRecognitionService;
