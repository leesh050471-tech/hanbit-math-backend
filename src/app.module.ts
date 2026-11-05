import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AdminController } from './academy/admin.controller';
import { AttendanceService } from './academy/attendance.service';
import { BasicsService } from './academy/basics.service';
import { EnrollmentsService } from './academy/enrollments.service';
import { MakeupsService } from './academy/makeups.service';
import { ParentController } from './academy/parent.controller';
import { ReportsService } from './academy/reports.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { AllExceptionsFilter } from './common/errors';
import { DbModule } from './db/db.module';
import { DbService } from './db/db.service';
import { StaffController } from './staff/staff.controller';

@Controller()
class HealthController {
  constructor(private readonly db: DbService) {}

  /** 서버가 깨어 있는지, DB에 닿는지 확인 */
  @Get('health')
  async health() {
    await this.db.query('SELECT 1');
    return { ok: true };
  }
}

@Module({
  imports: [
    DbModule,
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('JWT_SECRET 설정값이 없습니다 (.env 확인)');
        return { secret, signOptions: { expiresIn: '12h' } };
      },
    }),
  ],
  controllers: [HealthController, AuthController, StaffController, AdminController, ParentController],
  providers: [
    AuthService,
    BasicsService,
    EnrollmentsService,
    AttendanceService,
    MakeupsService,
    ReportsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
