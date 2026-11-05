import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 배포된 코어 웹과 어드민, 두 주소에서 오는 요청을 받는다
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  app.enableCors({ origin: origins, allowedHeaders: ['Content-Type', 'Authorization'] });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  console.log(`한빛수학 백엔드 실행 중: http://localhost:${port}`);
}
bootstrap();
