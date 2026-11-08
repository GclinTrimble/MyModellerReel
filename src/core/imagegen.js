// Image models for AI render (#64) and AI textures (#65): request building and reply reading for a local ComfyUI
// server and an OpenAI-compatible images API. Pure: the main process does the HTTP (keys never reach the page).

export const IMAGE_PROVIDERS = ['comfyui', 'openai'];

/**
 * A ComfyUI workflow in API format. mode img2img: the view (uploaded as `image`) redrawn at `strength` (0 keeps it,
 * 1 ignores it); txt2img: from the prompt alone at width × height.
 */
export function comfyWorkflow({ prompt, negative = '', image = null, strength = 0.55, checkpoint, steps = 25, cfg = 6.5, seed = 0, width = 1024, height = 1024 }) {
  if (!checkpoint) throw new Error('Set the ComfyUI checkpoint (a model file name) in AI settings.');
  const g = {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative || 'blurry, distorted, low quality, text, watermark', clip: ['4', 1] } },
    3: { class_type: 'KSampler', inputs: { seed: seed || Math.floor(Math.random() * 1e9), steps, cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: image ? Math.max(0.05, Math.min(1, strength)) : 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: image ? ['11', 0] : ['5', 0] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'MyModellerReel', images: ['8', 0] } },
  };
  if (image) Object.assign(g, { 10: { class_type: 'LoadImage', inputs: { image } }, 11: { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } } });
  else g[5] = { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } };
  return g;
}

/** The first saved image of a finished ComfyUI prompt in /history, or null while it runs. Throws on its error. */
export function comfyResult(history, promptId) {
  const h = history?.[promptId];
  if (!h) return null;
  if (h.status?.status_str === 'error') throw new Error(`ComfyUI: ${(h.status.messages || []).map((m) => m[1]?.exception_message).filter(Boolean).join('; ') || 'the prompt failed'}.`);
  for (const out of Object.values(h.outputs || {})) for (const im of out.images || []) if (im.type === 'output' || im.type === 'temp') return im;
  return h.status?.completed ? (() => { throw new Error('ComfyUI finished without an image.'); })() : null;
}

/** OpenAI-compatible images API: the request (url, json or form fields) for a generation or an edit of the view. */
export function openaiImageRequest({ prompt, image = null, model = 'gpt-image-1', size = '1024x1024', baseUrl = 'https://api.openai.com/v1' }) {
  const base = baseUrl.replace(/\/$/, '');
  if (image) return { url: `${base}/images/edits`, form: { model, prompt, size, n: '1' }, file: { field: 'image', name: 'view.png', type: 'image/png' } };
  return { url: `${base}/images/generations`, json: { model, prompt, size, n: 1 } };
}

/** The picture in an OpenAI images reply: base64 PNG, or a URL to fetch. */
export function openaiImageResult(json) {
  const d = json?.data?.[0];
  if (!d) throw new Error(json?.error?.message || 'The image model sent no picture.');
  return d.b64_json ? { b64: d.b64_json } : { url: d.url };
}

/** The prompt for a render of the view: what the user asked, kept to the geometry. */
export const renderPrompt = (prompt, style = '') => `${prompt}${style ? `, ${style}` : ''}. Keep the exact buildings, shapes, layout and camera of the reference image; photorealistic architectural visualisation.`;
/** The prompt for a seamless material texture. */
export const texturePrompt = (prompt) => `${prompt}, seamless tileable texture, flat even lighting, top-down orthographic photo, no shadows, no perspective, fills the frame`;
