import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertStorygraphSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  sessionCookie?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  rememberToken?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncOnStatusChange?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncOnProgressUpdate?: boolean;
}

export class ValidateStorygraphCookiesDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  sessionCookie?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  rememberToken?: string;
}
