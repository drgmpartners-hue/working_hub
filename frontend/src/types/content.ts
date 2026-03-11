/**
 * Content creation types for card news, report, and cover/promo pages.
 */

export type ContentType = 'card_news' | 'report' | 'cover_promo';
export type AIProvider = 'claude' | 'gemini';
export type ContentStatus = 'draft' | 'ai_generated' | 'approved' | 'completed';
export type VersionStatus = 'draft' | 'approved' | 'rejected';

export interface BrandSetting {
  id: number;
  brand_name: string;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  font_family: string | null;
  tagline: string | null;
}

export interface AISettingResponse {
  id: number;
  provider: AIProvider;
  model_name: string;
  is_active: boolean;
}

export interface ContentProject {
  id: number;
  content_type: ContentType;
  title: string;
  topic: string | null;
  content_input: string | null;
  status: ContentStatus;
  brand_setting_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ContentVersion {
  id: number;
  project_id: number;
  version_number: number;
  ai_provider: AIProvider;
  ai_model: string | null;
  ai_text_content: string | null;
  design_file_url: string | null;
  thumbnail_url: string | null;
  status: VersionStatus;
  rejection_reason: string | null;
  created_at: string;
}

export interface CreateContentProjectRequest {
  content_type: ContentType;
  title: string;
  topic?: string;
  content_input?: string;
  brand_setting_id?: number;
}

export interface CreateVersionRequest {
  ai_provider?: AIProvider;
  content_input?: string;
}
