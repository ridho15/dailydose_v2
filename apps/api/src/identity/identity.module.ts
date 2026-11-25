import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { AccessGuard } from './access.guard';
import { AuthGuard } from './auth.guard';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { PolicyService } from './policy.service';
import {
  ConfigGatedGoogleProvider,
} from './provider-adapters';
import { RateLimitService } from './rate-limit.service';
import { QueuedPasswordEmailProvider } from './email-provider';
import { LocalPrivateFileStorage, PRIVATE_FILE_STORAGE } from './private-file-storage';
import { S3PrivateFileStorage } from './s3-private-file-storage';
import { DevFallbackPrivateFileStorage } from './dev-fallback-private-file-storage';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { CustomerProfileService } from './customer-profile.service';
import { IdentityReviewQueryService } from './identity-review-query.service';
import { IdentityDocumentAccessService } from './identity-document-access.service';
import { AssignmentService } from './assignment.service';
import { IdentityDocumentWorkflowService } from './identity-document-workflow.service';
import { UserAdministrationService } from './user-administration.service';
import { AccessManagementController } from './access-management.controller';
import { AccessManagementService } from './access-management.service';
import { CustomerManagementController } from './customer-management.controller';
import { CustomerManagementService } from './manajemen-pelanggan.service';
import { InstructorManagementController } from './instructor-management.controller';
import { InstructorManagementService } from './manajemen-instruktur.service';
import { RolesGuard } from './roles.guard';
import { RoleAliasMigrationService } from './role-alias-migration.service';
import { HrGroupController } from './hr-group.controller';
import { HrGroupService } from './hr-group.service';
import { KeycloakJitService } from './keycloak-jit.service';
import { PetugasCheckinController } from './petugas-checkin.controller';
import { PetugasCheckinService } from './petugas-checkin.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    IdentityController,
    AccessManagementController,
    CustomerManagementController,
    InstructorManagementController,
    HrGroupController,
    PetugasCheckinController,
  ],
  providers: [
    RoleAliasMigrationService,
    IdentityService,
    KeycloakJitService,
    HrGroupService,
    CustomerProfileService,
    IdentityReviewQueryService,
    IdentityDocumentAccessService,
    AssignmentService,
    RolesGuard,
    // Default-deny: semua rute wajib login kecuali ditandai @Public().
    { provide: APP_GUARD, useClass: AccessGuard },
    IdentityDocumentWorkflowService,
    UserAdministrationService,
    PetugasCheckinService,
    AccessManagementService,
    CustomerManagementService,
    InstructorManagementService,
    PolicyService,
    ConfigGatedGoogleProvider,
    RateLimitService,
    QueuedPasswordEmailProvider,
    LocalPrivateFileStorage,
    S3PrivateFileStorage,
    {
      provide: PRIVATE_FILE_STORAGE,
      useFactory: (
        config: RuntimeConfigService,
        local: LocalPrivateFileStorage,
        s3: S3PrivateFileStorage,
      ) => {
        const isS3 =
          config.value.privateUploads.driver === 's3' ||
          config.value.privateUploads.driver === 'minio';
        if (!isS3) return local;
        if (config.value.environment !== 'production') {
          return new DevFallbackPrivateFileStorage(s3, local);
        }
        return s3;
      },
      inject: [RuntimeConfigService, LocalPrivateFileStorage, S3PrivateFileStorage],
    },
    AuthGuard,
  ],
  exports: [IdentityService, KeycloakJitService, PolicyService, RateLimitService, AuthGuard, RolesGuard, PRIVATE_FILE_STORAGE],
})
export class IdentityModule {}
