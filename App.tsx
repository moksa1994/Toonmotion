
import React, { useState, useEffect, useRef } from 'react';
import { Upload, Play, Download, Image as ImageIcon, Wand2, Loader2, AlertCircle, Settings, Key, CheckCircle2, XCircle, RotateCcw, Layers, Maximize, FileArchive, FileImage, Square, Ban } from 'lucide-react';
import { checkApiKey, promptApiKeySelection, generateAnimationFrames } from './services/gemini';
import { processGeneratedFrames, createApng, createGif, createZip } from './services/videoProcessor';
import { GenerationState, UserConfig, GeneratedFrame } from './types';

function App() {
  const [apiKeyReady, setApiKeyReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  // Store original image dimensions to ensure output matches input
  const [originalDimensions, setOriginalDimensions] = useState<{width: number, height: number} | null>(null);

  const [config, setConfig] = useState<UserConfig>({
    prompt: '',
    fps: 8,
    resolution: '720p',
    frameCount: 6,
    zoom: 1.0, // Default to 100% scale
  });
  
  const [generation, setGeneration] = useState<GenerationState>({
    isGenerating: false,
    progress: 0,
    statusMessage: ''
  });

  const [apngUrl, setApngUrl] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const previewIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Controller to abort generation
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    checkApiKey().then((ready) => {
       setApiKeyReady(ready);
    });
  }, []);

  useEffect(() => {
    if (generation.frames && generation.frames.length > 0) {
      previewIntervalRef.current = window.setInterval(() => {
        setPreviewIndex(prev => (prev + 1) % (generation.frames?.length || 1));
      }, 1000 / config.fps);
    }

    return () => {
      if (previewIntervalRef.current) clearInterval(previewIntervalRef.current);
    };
  }, [generation.frames, config.fps]);

  const handleApiKeySelect = async () => {
    setAuthError(null);
    try {
      await promptApiKeySelection();
      await new Promise(r => setTimeout(r, 500));
      const isReady = await checkApiKey();
      setApiKeyReady(isReady);
      return isReady;
    } catch (e) {
      console.error("API Key selection failed", e);
      return false;
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      
      // Read file and load into Image object to get natural dimensions
      const reader = new FileReader();
      reader.onload = (ev) => {
          const result = ev.target?.result as string;
          setImagePreview(result);
          
          const img = new Image();
          img.onload = () => {
              setOriginalDimensions({
                  width: img.naturalWidth,
                  height: img.naturalHeight
              });
          };
          img.src = result;
      };
      reader.readAsDataURL(file);
      
      setGeneration({ isGenerating: false, progress: 0, statusMessage: '' });
      setApngUrl(null);
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setImagePreview(null);
    setOriginalDimensions(null);
    setConfig(prev => ({ ...prev, prompt: '' }));
    setGeneration({
      isGenerating: false,
      progress: 0,
      statusMessage: ''
    });
    setApngUrl(null);
    setAuthError(null);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleStop = () => {
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
          setGeneration(prev => ({
              ...prev,
              isGenerating: false,
              statusMessage: '已停止生成',
              error: '用户停止了生成过程'
          }));
      }
  };

  const handleGenerate = async () => {
    setAuthError(null);

    if (!apiKeyReady) {
        const success = await handleApiKeySelect();
        if (!success) {
            setAuthError("需要API Key才能生成动画，请选择一个项目。");
            return;
        }
    }

    if (!imagePreview || !config.prompt || !imageFile) return;

    // Setup AbortController
    abortControllerRef.current = new AbortController();

    setGeneration({
      isGenerating: true,
      progress: 5,
      statusMessage: '初始化模型...'
    });
    setApngUrl(null);

    try {
        const base64Data = imagePreview.split(',')[1];
        const mimeType = imageFile.type;

        setGeneration(prev => ({ 
            ...prev, 
            progress: 20, 
            statusMessage: `正在生成 ${config.frameCount} 帧画面...` 
        }));
        
        // Generate distinct frames individually
        const frameUrls = await generateAnimationFrames(
            base64Data, 
            mimeType, 
            config.prompt, 
            config.frameCount,
            abortControllerRef.current.signal
        );
        
        setGeneration(prev => ({ ...prev, progress: 60, statusMessage: '正在处理并居中校正...' }));
        
        // Pass original dimensions AND config settings to the processor
        const targetW = originalDimensions?.width || 512;
        const targetH = originalDimensions?.height || 512;
        
        const frames = await processGeneratedFrames(
            frameUrls, 
            targetW, 
            targetH, 
            config.zoom
        );

        setGeneration(prev => ({ 
            ...prev, 
            progress: 80, 
            statusMessage: '正在打包 APNG, GIF 和序列帧...',
            frames
        }));

        // 1. Create APNG
        const apngBlob = await createApng(frames, config.fps);
        const finalUrl = URL.createObjectURL(apngBlob);
        setApngUrl(finalUrl);

        // 2. Create GIF
        let gifUrl = undefined;
        try {
            const gifBlob = await createGif(frames, config.fps);
            gifUrl = URL.createObjectURL(gifBlob);
        } catch (e) {
            console.warn("GIF creation failed", e);
        }

        // 3. Create ZIP
        let zipUrl = undefined;
        try {
            const zipBlob = await createZip(frames);
            zipUrl = URL.createObjectURL(zipBlob);
        } catch (e) {
             console.warn("ZIP creation failed", e);
        }

        setGeneration(prev => ({ 
            ...prev, 
            isGenerating: false, 
            progress: 100, 
            statusMessage: '完成!',
            videoUrl: finalUrl,
            gifUrl,
            zipUrl
        }));

    } catch (e: any) {
        if (e.message === "Generation aborted by user.") {
             // Already handled by stop handler
             return;
        }

        console.error("Generation Error:", e);

        let errorMessage = e.message || "An unknown error occurred";
        
        // JSON Error Parsing
        if (typeof errorMessage === 'string' && (errorMessage.includes('{') || errorMessage.includes('}'))) {
            try {
                const jsonMatch = errorMessage.match(/\{.*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : errorMessage;
                const parsed = JSON.parse(jsonStr);
                if (parsed.error) {
                    errorMessage = parsed.error.message || JSON.stringify(parsed.error);
                }
            } catch (err) {
            }
        }

        // Handle specific error types for better UX
        if (errorMessage.includes("API Key not found")) {
             setAuthError("API Key 丢失，请重新选择项目。");
             setApiKeyReady(false);
             setGeneration(prev => ({ ...prev, isGenerating: false, statusMessage: '' }));
        } else if (errorMessage.includes("SAFETY")) {
             setGeneration(prev => ({
                ...prev,
                isGenerating: false,
                error: "触发了安全过滤器。模型拒绝生成其中一帧，请尝试简化提示词或更换角色图片。"
            }));
        } else {
            setGeneration(prev => ({
                ...prev,
                isGenerating: false,
                error: errorMessage
            }));
        }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 selection:bg-yellow-200 selection:text-yellow-900 font-sans">
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-yellow-400 to-orange-500 p-2 rounded-xl shadow-md shadow-orange-500/20">
              <Wand2 className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-bold tracking-tight text-gray-900 leading-tight">ToonMotion</h1>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Powered by Gemini</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             <button 
                onClick={handleApiKeySelect}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-full transition-all border shadow-sm ${
                    apiKeyReady 
                    ? 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300' 
                    : 'bg-white text-amber-600 border-amber-200 hover:bg-amber-50 hover:border-amber-300'
                }`}
             >
                {apiKeyReady ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
                {apiKeyReady ? '已连接' : '连接 API Key'}
             </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-5 space-y-6">
          {authError && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
               <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
               <div className="space-y-1">
                   <p className="text-sm text-red-700 font-medium">{authError}</p>
                   {authError.includes("Project") && (
                       <p className="text-xs text-red-600/80">Tip: 如果显示 "No Cloud Projects"，请在下拉菜单中点击 "Create Project"。</p>
                   )}
               </div>
            </div>
          )}

          <section className="bg-white rounded-2xl p-1 border border-gray-200 shadow-sm">
            <div className="p-5 rounded-xl">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="bg-gray-100 text-gray-600 border border-gray-200 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold">1</span>
                上传角色图片
                </h2>
                
                <div className="relative group">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${imagePreview ? 'border-yellow-500 bg-yellow-50/50' : 'border-gray-300 hover:border-yellow-400 hover:bg-gray-50'}`}>
                    {imagePreview ? (
                    <div className="relative">
                        <img 
                            src={imagePreview} 
                            alt="Preview" 
                            className="max-h-64 mx-auto rounded-lg shadow-md object-contain bg-white" 
                        />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                        <p className="text-white font-medium flex items-center gap-2">
                            <Upload className="w-4 h-4" /> 更换图片
                        </p>
                        </div>
                    </div>
                    ) : (
                    <div className="space-y-4 py-4">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                        <ImageIcon className="w-8 h-8 text-gray-400 group-hover:text-yellow-500 transition-colors" />
                        </div>
                        <div>
                        <p className="text-gray-900 font-medium">点击上传角色</p>
                        <p className="text-gray-500 text-xs mt-1">建议使用透明背景图片</p>
                        </div>
                    </div>
                    )}
                </div>
                </div>
            </div>
          </section>

          <section className="bg-white rounded-2xl p-1 border border-gray-200 shadow-sm">
             <div className="p-5 rounded-xl">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <span className="bg-gray-100 text-gray-600 border border-gray-200 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold">2</span>
                    动画设置
                </h2>

                <div className="space-y-5">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                    动作提示词
                    </label>
                    <textarea
                    value={config.prompt}
                    onChange={(e) => setConfig({ ...config, prompt: e.target.value })}
                    placeholder="例如：开心地跳跃，快速奔跑，挥手打招呼..."
                    className="w-full bg-white border border-gray-300 rounded-xl p-3 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-yellow-500 focus:border-transparent outline-none resize-none h-24 transition-all text-sm shadow-sm"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5" /> 生成帧数
                        </label>
                        <select 
                            value={config.frameCount}
                            onChange={(e) => setConfig({...config, frameCount: parseInt(e.target.value)})}
                            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-yellow-500 outline-none"
                        >
                            <option value={2}>2 帧</option>
                            <option value={4}>4 帧</option>
                            <option value={6}>6 帧</option>
                            <option value={8}>8 帧</option>
                            <option value={10}>10 帧</option>
                            <option value={12}>12 帧</option>
                        </select>
                    </div>

                    <div>
                         <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-medium text-gray-700">
                            播放速度
                            </label>
                            <span className="text-xs font-mono bg-gray-100 border border-gray-200 px-2 py-0.5 rounded text-gray-600">{config.fps} FPS</span>
                        </div>
                        <input 
                            type="range" 
                            min="4" 
                            max="12" 
                            step="1"
                            value={config.fps}
                            onChange={(e) => setConfig({...config, fps: parseInt(e.target.value)})}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                        />
                    </div>
                </div>
                
                {/* Scale Slider */}
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                            <Maximize className="w-3.5 h-3.5" /> 画面主体缩放
                        </label>
                        <span className="text-xs font-mono bg-gray-100 border border-gray-200 px-2 py-0.5 rounded text-gray-600">{Math.round(config.zoom * 100)}%</span>
                    </div>
                    <input 
                        type="range" 
                        min="0.5" 
                        max="1.0" 
                        step="0.05"
                        value={config.zoom}
                        onChange={(e) => setConfig({...config, zoom: parseFloat(e.target.value)})}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                    />
                </div>

                <div className="flex gap-3 mt-2">
                    <button
                        onClick={handleReset}
                        disabled={generation.isGenerating || (!imagePreview && !config.prompt)}
                        className="px-4 py-4 rounded-xl font-bold text-sm border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-red-500 hover:border-red-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center justify-center"
                        title="重置 / 清空"
                    >
                        <RotateCcw className="w-5 h-5" />
                    </button>

                    {generation.isGenerating ? (
                        <button
                            onClick={handleStop}
                            className="flex-1 py-4 rounded-xl font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] shadow-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                        >
                            <Ban className="w-5 h-5" />
                            停止生成
                        </button>
                    ) : (
                        <button
                            onClick={handleGenerate}
                            disabled={!imagePreview || !config.prompt}
                            className={`flex-1 py-4 rounded-xl font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] shadow-lg
                            ${(!imagePreview || !config.prompt)
                                ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed shadow-none'
                                : 'bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-400 hover:to-orange-500 text-white shadow-orange-500/30'
                            }`}
                        >
                            <Wand2 className="w-5 h-5" />
                            生成动画
                        </button>
                    )}
                </div>
                
                {generation.error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-600 text-xs mt-2 break-words">
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="flex-1">{generation.error}</p>
                    </div>
                )}
                </div>
            </div>
          </section>
        </div>

        <div className="lg:col-span-7">
           <div className="sticky top-24 bg-white rounded-2xl p-1 border border-gray-200 shadow-sm min-h-[500px] flex flex-col">
              <div className="p-6 rounded-xl h-full flex flex-col">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <span className="bg-gray-100 text-gray-600 border border-gray-200 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold">3</span>
                    生成结果
                </h2>

                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50/50 rounded-xl border-2 border-dashed border-gray-200 p-8 relative overflow-hidden min-h-[400px]">
                    
                    {generation.isGenerating && (
                    <div className="absolute inset-0 z-20 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center">
                        <div className="relative">
                            <div className="w-20 h-20 border-4 border-gray-200 border-t-yellow-500 rounded-full animate-spin mb-6"></div>
                            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-900">{generation.progress}%</div>
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">正在制作动画</h3>
                        <p className="text-gray-500 text-sm max-w-xs animate-pulse mb-8">{generation.statusMessage}</p>
                        
                        <div className="w-64 bg-gray-200 h-1.5 rounded-full overflow-hidden">
                             <div 
                                className="h-full bg-yellow-500 transition-all duration-300 ease-out"
                                style={{ width: `${generation.progress}%` }}
                             />
                        </div>
                    </div>
                    )}

                    {!generation.isGenerating && !apngUrl && !generation.frames && (
                    <div className="text-center text-gray-400">
                        <div className="w-24 h-24 bg-white border border-gray-100 shadow-sm rounded-full flex items-center justify-center mx-auto mb-6">
                            <Play className="w-10 h-10 text-gray-300 ml-1" />
                        </div>
                        <p className="font-medium text-gray-600 text-lg">动画预览区域</p>
                        <p className="text-sm mt-2 max-w-xs mx-auto text-gray-400">上传图片并点击生成，即可让角色动起来！</p>
                    </div>
                    )}

                    {!generation.isGenerating && generation.frames && generation.frames.length > 0 && (
                    <div className="flex flex-col items-center w-full animate-in zoom-in-95 duration-300">
                        <div className="relative bg-white rounded-lg shadow-lg overflow-hidden border border-gray-200 mb-6 group">
                        {/* Display at original size or scaled down if too big, but generated frames are actual size */}
                        <img 
                            src={generation.frames[previewIndex].dataUrl} 
                            alt={`Frame ${previewIndex}`}
                            className="max-w-full max-h-[500px] object-contain"
                        />
                        <div className="absolute top-3 right-3 bg-white/90 px-2 py-1 rounded border border-gray-200 text-[10px] font-mono text-gray-600 shadow-sm backdrop-blur-sm">
                             Preview
                        </div>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/90 px-3 py-1 rounded-full border border-gray-200 text-xs font-medium text-gray-700 shadow-sm backdrop-blur-sm">
                             帧 {previewIndex + 1} / {generation.frames.length}
                        </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg">
                             {/* APNG Download */}
                            <a 
                                href={apngUrl || '#'} 
                                download={`toonmotion-${Date.now()}.png`}
                                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                                    apngUrl 
                                    ? 'bg-white border-emerald-200 hover:bg-emerald-50 text-emerald-700 cursor-pointer shadow-sm hover:shadow-md' 
                                    : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                                onClick={(e) => !apngUrl && e.preventDefault()}
                            >
                                <Download className="w-5 h-5 mb-1" />
                                <span className="text-xs font-bold">下载 APNG</span>
                                <span className="text-[10px] opacity-70">最佳质量</span>
                            </a>

                            {/* GIF Download */}
                            <a 
                                href={generation.gifUrl || '#'} 
                                download={`toonmotion-${Date.now()}.gif`}
                                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                                    generation.gifUrl 
                                    ? 'bg-white border-purple-200 hover:bg-purple-50 text-purple-700 cursor-pointer shadow-sm hover:shadow-md' 
                                    : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                                onClick={(e) => !generation.gifUrl && e.preventDefault()}
                            >
                                <FileImage className="w-5 h-5 mb-1" />
                                <span className="text-xs font-bold">下载 GIF</span>
                                <span className="text-[10px] opacity-70">兼容性好</span>
                            </a>

                            {/* ZIP Download */}
                            <a 
                                href={generation.zipUrl || '#'} 
                                download={`toonmotion-frames-${Date.now()}.zip`}
                                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                                    generation.zipUrl 
                                    ? 'bg-white border-blue-200 hover:bg-blue-50 text-blue-700 cursor-pointer shadow-sm hover:shadow-md' 
                                    : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                                onClick={(e) => !generation.zipUrl && e.preventDefault()}
                            >
                                <FileArchive className="w-5 h-5 mb-1" />
                                <span className="text-xs font-bold">下载序列帧</span>
                                <span className="text-[10px] opacity-70">PNG ZIP包</span>
                            </a>
                        </div>
                    </div>
                    )}
                </div>
              </div>
           </div>
        </div>
      </main>
    </div>
  );
}

export default App;
