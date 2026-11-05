import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AllowPendingPasswordChange, Auth, CurrentUser, User } from './auth.decorators';
import { ChangePasswordDto, LoginDto, ParentSignupDto } from './auth.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ── 학부모 (코어 웹) ──
  @Post('parent/signup')
  signup(@Body() dto: ParentSignupDto) {
    return this.auth.parentSignup(dto);
  }

  @Post('parent/login')
  @HttpCode(200)
  parentLogin(@Body() dto: LoginDto) {
    return this.auth.parentLogin(dto);
  }

  @Get('parent/me')
  @Auth('parent')
  parentMe(@User() user: CurrentUser) {
    return user;
  }

  // ── 직원 (어드민) ──
  @Post('staff/login')
  @HttpCode(200)
  staffLogin(@Body() dto: LoginDto) {
    return this.auth.staffLogin(dto);
  }

  @Get('staff/me')
  @Auth('staff')
  @AllowPendingPasswordChange()
  staffMe(@User() user: CurrentUser) {
    return user;
  }

  @Post('staff/change-password')
  @HttpCode(200)
  @Auth('staff')
  @AllowPendingPasswordChange()
  changePassword(@User() user: CurrentUser, @Body() dto: ChangePasswordDto) {
    return this.auth.staffChangePassword(user, dto);
  }
}
