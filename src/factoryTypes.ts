import type { UploadedAsset } from './types';

export type FactoryStylePreset =
  | 'factory_conveyor'
  | 'warehouse_flashsale'
  | 'home_real_pov';

export type McOutfitPreset =
  | 'cream_polo'
  | 'navy_workwear'
  | 'brand_shirt';

export type AidaStage =
  | 'Attention (Thu hút tại xưởng)'
  | 'Interest (Chất liệu & Thiết kế)'
  | 'Interest (Dung tích & Thông số)'
  | 'Desire (Test thực tế)'
  | 'Action (Kho hàng & Chốt giỏ)';

export interface FactorySceneItem {
  sceneNumber: number;
  aidaStage: AidaStage;
  title: string;
  cameraAngle: string;
  imagePrompt916: string;
  spokenDialogueVi: string;
  videoPrompt6s: string;
  durationSeconds: number;
  keyframeAsset: UploadedAsset | null;
  linkedJobId?: string | null;
}

export type FactoryProjectStatus =
  | 'draft'
  | 'generating_clips'
  | 'stitching'
  | 'completed'
  | 'partial_failed';

export interface StitchedVideoOutput {
  filename: string;
  url: string;
  downloadUrl: string;
  durationSeconds: number;
  sceneCount: number;
  resolution: string;
  sizeBytes: number;
  createdAt: string;
}

export interface FactoryProject {
  id: string;
  productName: string;
  productHighlights: string;
  stylePreset: FactoryStylePreset;
  mcOutfitPreset: McOutfitPreset;
  videoModel: string;
  productAssets: UploadedAsset[];
  mcFaceAsset: UploadedAsset | null;
  masterPromptUsed: string;
  scenes: FactorySceneItem[];
  status: FactoryProjectStatus;
  statusMessage: string;
  stitchedOutput: StitchedVideoOutput | null;
  createdAt: string;
  updatedAt: string;
}
