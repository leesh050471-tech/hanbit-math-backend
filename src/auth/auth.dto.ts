import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: '이메일 형식이 올바르지 않습니다.' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: '비밀번호를 입력해 주세요.' })
  password: string;
}

export class ParentSignupDto {
  @IsEmail({}, { message: '이메일 형식이 올바르지 않습니다.' })
  email: string;

  @IsString()
  @MinLength(8, { message: '비밀번호는 8자 이상이어야 합니다.' })
  @MaxLength(72, { message: '비밀번호는 72자 이하여야 합니다.' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: '이름을 입력해 주세요.' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: '연락처를 입력해 주세요.' })
  phone: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: '지금 비밀번호를 입력해 주세요.' })
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: '새 비밀번호는 8자 이상이어야 합니다.' })
  @MaxLength(72, { message: '비밀번호는 72자 이하여야 합니다.' })
  newPassword: string;
}
