import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import type { ApplyHardcoverImportPayload, UpdateHardcoverBookSyncPayload } from '@bookorbit/types';

export class UpsertHardcoverSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  apiToken?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['all_eligible', 'selected_only'])
  bookSyncMode?: 'all_eligible' | 'selected_only';

  @IsOptional()
  @IsBoolean()
  autoSyncOnStatusChange?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncOnProgressUpdate?: boolean;

  @IsOptional()
  @IsBoolean()
  deviceProgressSyncEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  deviceProgressSyncDelayMinutes?: number;

  @IsOptional()
  @IsBoolean()
  autoSyncOnRatingChange?: boolean;

  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3])
  privacySettingId?: number;
}

export class ValidateHardcoverTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  token?: string;
}

export class UpdateHardcoverBookSyncDto implements UpdateHardcoverBookSyncPayload {
  @IsBoolean()
  syncEnabled!: boolean;
}

export class ApplyHardcoverImportDto implements ApplyHardcoverImportPayload {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  hardcoverUserBookIds?: number[];

  @IsOptional()
  @IsBoolean()
  importProgress?: boolean;
}

export class LinkHardcoverBookDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2048)
  input!: string;
}

export class SetHardcoverEditionDto {
  @IsInt()
  editionId!: number;
}
