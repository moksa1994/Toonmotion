
export interface GeneratedFrame {
  blob: Blob;
  dataUrl: string;
  index: number;
  pixelBuffer?: ArrayBuffer;
  width?: number;
  height?: number;
}

export interface GenerationState {
  isGenerating: boolean;
  progress: number; // 0-100
  statusMessage: string;
  videoUrl?: string; // Used for APNG URL primarily
  gifUrl?: string;
  zipUrl?: string;
  frames?: GeneratedFrame[];
  error?: string;
}

export interface UserConfig {
  prompt: string;
  fps: number; // Frames per second for the output APNG
  resolution: '720p' | '1080p';
  frameCount: number; // Total number of frames to generate
  zoom: number; // Scale factor for the subject (0.5 to 1.0)
}

declare global {
  // Move AIStudio interface to global scope to ensure consistency
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    // Add optional aistudio property to Window interface
    aistudio?: AIStudio;

    UPNG: {
      encode: (imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels: number[]) => ArrayBuffer;
    };
    
    // External libraries loaded via script tags
    JSZip: any;
    GIF: any;
  }
}
