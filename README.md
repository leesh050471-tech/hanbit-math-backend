# hanbit-math-backend

수학학원 "한빛수학"의 수강·출결 관리 백엔드입니다 (NestJS + PostgreSQL).
코어 웹(학부모)과 어드민 웹(직원)이 이 백엔드 하나를 함께 씁니다. DB 주소와 API 키는 이 서버의 설정값에만 둡니다.

> ⏰ **무료 서버라 15분 동안 안 쓰면 잠듭니다.** 첫 접속은 1분 가까이 걸릴 수 있어요. `/health`를 한 번 열어 깨워 두세요.

## 실행 (내 컴퓨터)

```bash
npm install
cp .env.example .env      # 값 채우기 (DATABASE_URL은 Render의 External 주소, DB_SSL=true)
npm run db:migrate        # hw2 스키마와 테이블 만들기
npm run db:seed           # 처음 관리자 + 가상 데이터
npm run dev               # http://localhost:4000
```

- `npm run db:reset`은 **hw2 스키마만** 지우고 다시 만듭니다. 1주차 과제 테이블은 건드리지 않습니다.

## Render 배포

| 항목 | 값 |
|---|---|
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm run start` |
| Health Check Path | `/health` |

환경 변수 (Render → Environment):

| 이름 | 값 |
|---|---|
| `DATABASE_URL` | Render DB의 **Internal** 주소 (같은 Render 안이라 내부 주소) |
| `DB_SSL` | `false` |
| `JWT_SECRET` | 긴 임의 문자열 |
| `CORS_ORIGINS` | 배포된 코어 웹 주소,어드민 주소 (쉼표로 구분) |
| `DIFY_API_URL`, `DIFY_API_KEY` | (선택) 규정 챗봇 |

## 주요 주소

| 주소 | 누가 | 내용 |
|---|---|---|
| `POST /auth/parent/signup`, `/auth/parent/login` | 누구나 | 학부모 가입·로그인 |
| `POST /auth/staff/login`, `/auth/staff/change-password` | 직원 | 직원 로그인·비밀번호 변경 |
| `/admin/staff/*` | 관리자 | 직원 계정 만들기·고치기·사용 중지·비밀번호 리셋 |
| `/admin/*` | 직원 | 학생, 반, 수강, 출결, 보강, 수강료, 현황 |
| `/me/*` | 학부모 | 내 자녀, 수강 신청·취소, 자녀 요약 |

## 규칙을 지키는 곳

- **DB 제약** (`sql/001_schema.sql`): 이메일 중복, 학년·정원·금액 범위, 끝 > 시작, 강사 시간 겹침(배제 제약), 같은 반 중복 수강(배제 제약), 하루 출결 하나, 결석 하나에 보강 하나, 달마다 납부 하나
- **백엔드** (`src/academy/*.service.ts`): 정원(반 행을 잠그고 셈), 학년 일치, 보강일 인원, 보강 조건, 출결 날짜, 로그인·역할
- DB 제약에 걸리면 `src/common/errors.ts`가 제약 이름을 쉬운 말로 바꿔 돌려줍니다.
