import { GoogleGenAI, Modality } from "@google/genai";

const getAiClient = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key not found. Please select an API Key.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

/**
 * Generates a single frame based on the input image and prompt.
 */
const generateSingleFrame = async (
  imageBase64: string,
  mimeType: string,
  prompt: string,
  index: number,
  total: number
): Promise<string> => {
  const ai = getAiClient();

  // Prompt optimized for single-frame consistency
  const enhancedPrompt = `Generate frame ${index + 1} of ${total} for an animation sequence.
  
  Subject: Fictional, generic chibi game character.
  Visual Style: 2D digital game art, flat color, high contrast.
  Action: ${prompt}
  
  CRITICAL CONSTRAINTS:
  1. **View**: Full body, Frontal, Orthographic view.
  2. **Background**: Pure White (#FFFFFF).
  3. **Framing**: Character must be fully visible within the frame, no cropping.
  4. **Consistency**: Maintain exact character proportions and design details from the reference image.
  5. **Content**: NO text, NO grid lines, NO numbers, NO extra objects. One character only.
  
  Output: A single high-quality image.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image', 
      contents: {
        parts: [
          {
            inlineData: {
              data: imageBase64,
              mimeType: mimeType,
            },
          },
          {
            text: enhancedPrompt,
          },
        ],
      },
      config: {
          responseModalities: [Modality.IMAGE],
      },
    });

    const candidate = response.candidates?.[0];

    if (!candidate) {
        throw new Error("Gemini API returned no candidates.");
    }

    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        throw new Error(`Model stopped generation: ${candidate.finishReason}`);
    }

    const part = candidate.content?.parts?.[0];
    
    if (part && part.text) {
        throw new Error(`Model Refusal: ${part.text.slice(0, 100)}...`);
    }

    if (!part || !part.inlineData || !part.inlineData.data) {
        throw new Error("No image data generated.");
    }

    const base64Image = part.inlineData.data;
    const resultMime = part.inlineData.mimeType || 'image/png';
    
    // Convert Base64 to Blob URL
    const byteCharacters = atob(base64Image);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: resultMime });
    return URL.createObjectURL(blob);

  } catch (error: any) {
    console.error(`Error generating frame ${index + 1}:`, error);
    throw error;
  }
};

/**
 * Generates multiple frames in parallel batches.
 * Supports abortion via AbortSignal.
 */
export const generateAnimationFrames = async (
  imageBase64: string,
  mimeType: string,
  prompt: string,
  count: number,
  signal?: AbortSignal
): Promise<string[]> => {
  const urls: string[] = [];
  const batchSize = 3; // Process 3 at a time to avoid rate limits

  for (let i = 0; i < count; i += batchSize) {
    if (signal?.aborted) {
        throw new Error("Generation aborted by user.");
    }

    const batchPromises = [];
    for (let j = i; j < Math.min(i + batchSize, count); j++) {
       // Add a tiny delay between requests to be nice to the API
       await new Promise(r => setTimeout(r, 100 * (j - i)));
       batchPromises.push(generateSingleFrame(imageBase64, mimeType, prompt, j, count));
    }
    
    const batchResults = await Promise.all(batchPromises);
    
    if (signal?.aborted) {
        throw new Error("Generation aborted by user.");
    }
    
    urls.push(...batchResults);
  }

  return urls;
};

export const checkApiKey = async (): Promise<boolean> => {
  if (process.env.API_KEY && process.env.API_KEY.length > 0) {
    return true;
  }
  if (typeof window !== 'undefined' && window.aistudio && window.aistudio.hasSelectedApiKey) {
    try {
        return await window.aistudio.hasSelectedApiKey();
    } catch (e) {
        console.warn("Failed to check hasSelectedApiKey", e);
        return false;
    }
  }
  return false;
};

export const promptApiKeySelection = async (): Promise<void> => {
  if (window.aistudio && window.aistudio.openSelectKey) {
    await window.aistudio.openSelectKey();
  } else {
    console.warn("AIStudio API selection not available in this environment.");
  }
};