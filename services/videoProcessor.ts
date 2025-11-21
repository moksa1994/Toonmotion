
import { GeneratedFrame } from "../types";

/**
 * Processes a single frame to:
 * 1. Remove white background
 * 2. Apply Safety Margin
 * 3. Return Bounding Box and Cleaned Canvas
 */
const processFrameData = (
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
) => {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = 0;
  let maxY = 0;
  let foundPixel = false;

  // Strict Threshold for "White" background removal
  const threshold = 240;
  
  // Safety Margin: 5% edge crop to remove potential artifacts
  const marginX = Math.floor(canvas.width * 0.05);
  const marginY = Math.floor(canvas.height * 0.05);

  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % canvas.width;
    const y = Math.floor((i / 4) / canvas.width);

    // 1. SAFETY CROP
    if (x < marginX || x > canvas.width - marginX || y < marginY || y > canvas.height - marginY) {
        data[i + 3] = 0; 
        continue;
    }

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // 2. BACKGROUND REMOVAL
    if (r > threshold && g > threshold && b > threshold) {
      data[i + 3] = 0; // Transparent
    } else {
      // Character pixel
      if (data[i + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        foundPixel = true;
      }
    }
  }

  if (!foundPixel) return null;

  const charWidth = maxX - minX;
  const charHeight = maxY - minY;

  // Extract the cropped character to a new temporary canvas
  const charCanvas = document.createElement('canvas');
  charCanvas.width = charWidth;
  charCanvas.height = charHeight;
  const charCtx = charCanvas.getContext('2d');
  if (!charCtx) return null;

  // Put the cleaned data back
  ctx.putImageData(imageData, 0, 0);
  // Draw cropped region to temp canvas
  charCtx.drawImage(canvas, minX, minY, charWidth, charHeight, 0, 0, charWidth, charHeight);
  
  return {
      image: charCanvas,
      width: charWidth,
      height: charHeight
  };
};

/**
 * Processes a list of generated image URLs.
 * Resizes, centers, and normalizes them into uniform frames.
 */
export const processGeneratedFrames = async (
  imageUrls: string[],
  targetWidth: number,
  targetHeight: number,
  zoom: number = 1.0
): Promise<GeneratedFrame[]> => {
  const frames: GeneratedFrame[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    
    await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = async () => {
            const processed = processFrameData(img, targetWidth, targetHeight);
            
            // Create final frame canvas
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = targetWidth;
            finalCanvas.height = targetHeight;
            const finalCtx = finalCanvas.getContext('2d');

            if (finalCtx && processed) {
                const { image, width, height } = processed;

                // --- SCALE NORMALIZATION ---
                const baseScale = 0.85;
                const targetCharHeight = targetHeight * baseScale * zoom;
                const scale = targetCharHeight / height;
                
                const drawW = width * scale;
                const drawH = height * scale;

                // --- ABSOLUTE CENTERING ---
                const destX = (targetWidth - drawW) / 2;
                const destY = (targetHeight - drawH) / 2;

                // Draw Character (Top Layer)
                finalCtx.drawImage(image, 0, 0, width, height, destX, destY, drawW, drawH);

                // Export Frame
                const blob = await new Promise<Blob | null>(r => finalCanvas.toBlob(r, 'image/png'));
                const pixelData = finalCtx.getImageData(0, 0, targetWidth, targetHeight);
                
                if (blob) {
                    frames.push({
                        blob,
                        dataUrl: URL.createObjectURL(blob),
                        index: i,
                        pixelBuffer: pixelData.data.buffer,
                        width: targetWidth,
                        height: targetHeight
                    });
                }
            }
            resolve();
        };
        img.onerror = () => {
            console.error(`Failed to load image ${i}`);
            resolve(); // Skip failed frames but continue
        };
        img.src = url;
    });
  }
  
  return frames;
};

export const createApng = async (frames: GeneratedFrame[], fps: number): Promise<Blob> => {
  if (!window.UPNG) {
    throw new Error("UPNG library not loaded");
  }
  if (frames.length === 0) {
    throw new Error("No frames to encode");
  }

  const buffers: ArrayBuffer[] = [];
  const width = frames[0].width || 0;
  const height = frames[0].height || 0;

  for (const frame of frames) {
    if (frame.pixelBuffer) {
        buffers.push(frame.pixelBuffer);
    }
  }

  const delay = Math.round(1000 / fps);
  const delays = new Array(buffers.length).fill(delay);

  try {
      const apngBuffer = window.UPNG.encode(buffers, width, height, 0, delays);
      return new Blob([apngBuffer], { type: 'image/png' });
  } catch (e) {
      console.error("UPNG Encoding Error:", e);
      throw new Error("Failed to encode APNG.");
  }
};

/**
 * Generates a GIF blob from frames using GIF.js
 */
export const createGif = async (frames: GeneratedFrame[], fps: number): Promise<Blob> => {
    if (!window.GIF) {
        throw new Error("GIF.js library not loaded");
    }
    
    return new Promise(async (resolve, reject) => {
        try {
            // We need to load the worker script content manually to avoid CORS issues with cross-origin workers
            const workerBlobResponse = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js');
            const workerBlobText = await workerBlobResponse.text();
            const workerBlob = new Blob([workerBlobText], { type: "application/javascript" });
            const workerUrl = URL.createObjectURL(workerBlob);

            const gifConfig: any = {
                workers: 2,
                quality: 10,
                width: frames[0].width,
                height: frames[0].height,
                workerScript: workerUrl,
                transparent: 0xFF00FF // Magenta Key
            };

            const gif = new window.GIF(gifConfig);

            for (const frame of frames) {
                if (frame.pixelBuffer && frame.width && frame.height) {
                    let finalImageData: ImageData;

                    // APPLY MAGENTA KEYING FOR TRANSPARENCY
                    // Create a new buffer to avoid modifying the original used for APNG
                    const originalBuffer = new Uint8ClampedArray(frame.pixelBuffer);
                    const newBuffer = new Uint8ClampedArray(originalBuffer.length);
                    
                    for (let i = 0; i < originalBuffer.length; i += 4) {
                        const r = originalBuffer[i];
                        const g = originalBuffer[i+1];
                        const b = originalBuffer[i+2];
                        const a = originalBuffer[i+3];

                        if (a < 128) {
                            // Background -> Magenta
                            newBuffer[i] = 255;   // R
                            newBuffer[i+1] = 0;   // G
                            newBuffer[i+2] = 255; // B
                            newBuffer[i+3] = 255; // A (Opaque)
                        } else {
                            // Foreground -> Keep color, Force Opaque
                            newBuffer[i] = r;
                            newBuffer[i+1] = g;
                            newBuffer[i+2] = b;
                            newBuffer[i+3] = 255; // Force Opaque to protect whites
                        }
                    }
                    finalImageData = new ImageData(newBuffer, frame.width, frame.height);
                    
                    gif.addFrame(finalImageData, { delay: 1000 / fps });
                }
            }

            gif.on('finished', (blob: Blob) => {
                URL.revokeObjectURL(workerUrl); // Clean up
                resolve(blob);
            });

            gif.render();
        } catch (e) {
            console.error("GIF Creation Failed:", e);
            reject(e);
        }
    });
};

/**
 * Creates a ZIP file containing all individual PNG frames
 */
export const createZip = async (frames: GeneratedFrame[]): Promise<Blob> => {
    if (!window.JSZip) {
        throw new Error("JSZip library not loaded");
    }

    const zip = new window.JSZip();
    const folder = zip.folder("frames");

    frames.forEach((frame, index) => {
        // Pad index with leading zeros, e.g., frame_01.png
        const fileName = `frame_${(index + 1).toString().padStart(2, '0')}.png`;
        folder.file(fileName, frame.blob);
    });

    return await zip.generateAsync({ type: "blob" });
};

export const sliceSpriteSheet = async (): Promise<GeneratedFrame[]> => { return []; };
export const extractFramesFromVideo = async (): Promise<GeneratedFrame[]> => { return []; };
