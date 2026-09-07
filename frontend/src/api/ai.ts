import api from './client';

export const aiApi = {
  generateScript: (product: string, style: string, format: string) =>
    api.post<{ data: { text: string } }>('/ai/generate-script', { product, style, format }),

  analyzeUrl: (url: string, context?: string) =>
    api.post<{ data: Record<string, unknown> }>('/ai/analyze-url', { url, context }),

  analyzeCampaign: (productName: string, description: string, objective: string) =>
    api.post('/ai/analyze-campaign', { productName, description, objective }),

  // Claude analyzes product photo + generates optimized prompt for OpenAI Images
  buildImagePrompt: (body: {
    product: string;
    style?: string;
    format?: '9:16' | '4:5' | '1:1';
    hook?: string;
    description?: string;
    imageBase64?: string;
    mimeType?: string;
  }) =>
    api.post<{ data: { prompt: string } }>('/generative/image-prompt', body, { timeout: 30_000 }),

  // OpenAI gpt-image-1 — key stays server-side (no VITE_OPENAI_API_KEY in the browser)
  generateOpenAIImage: (body: {
    product: string;
    style?: string;
    format?: '9:16' | '4:5' | '1:1';
    hook?: string;
    description?: string;
    prompt?: string;
  }) =>
    api.post<{ data: { imageBase64: string } }>('/generative/openai-image', body, { timeout: 120_000 }),
};
