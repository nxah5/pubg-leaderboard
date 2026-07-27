# PUBG Match Leaderboard

PUBG API에서 플레이어 최근 매치와 매치별 roster/participant 정보를 가져와 라운드별 팀 점수 리더보드를 계산하는 앱입니다. Neon PostgreSQL을 연결하면 메인 설정과 OBS 상태가 여러 브라우저와 기기에서 공유됩니다.

## 실행

```bash
cp .env.example .env
npm install
# .env의 PUBG_API_KEY 값을 본인 키로 교체
node server.js
```

Codex 번들 Node를 사용할 때:

```bash
/Users/noah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

브라우저에서 `http://localhost:4177`을 열면 됩니다.

OBS Studio 브라우저 소스에는 `http://localhost:4177/obs.html`을 넣으면 됩니다. 메인 화면이 최신 집계를 서버에 발행하고, OBS 화면은 그 상태를 1초마다 읽습니다.

`DATABASE_URL`이 없으면 로컬 메모리와 브라우저 캐시로 동작합니다. 이 모드에서는 서버를 재시작하거나 다른 기기로 접속했을 때 데이터가 유지되지 않습니다.

## Neon 공유 데이터베이스

1. Neon에서 프로젝트를 만들고 프로젝트 화면의 **Connect**를 누릅니다.
2. **Connection pooling**을 켜고 `-pooler`가 포함된 연결 문자열을 복사합니다.
3. 연결 문자열 전체를 Render의 `DATABASE_URL` 환경 변수에 넣습니다.
4. Render의 `APP_SYNC_TOKEN`에는 직접 만든 긴 임의 문자열을 넣습니다.
5. 배포 후 메인 화면의 **동기화 편집 키**에 `APP_SYNC_TOKEN`과 같은 값을 입력합니다.

서버는 첫 DB 연결 때 `public.pubg_leaderboard_state` 테이블을 자동으로 만듭니다. Neon SQL 편집기에서 별도의 테이블 생성 쿼리를 실행할 필요가 없습니다.

동기화 방식:

- 메인 화면을 열면 Neon의 최신 상태를 먼저 불러옵니다.
- 수정 내용은 약 0.5초 후 Neon에 자동 저장됩니다.
- 열려 있는 다른 메인 화면은 약 3초 이내에 변경을 반영합니다.
- OBS 상태도 Neon에 저장되어 Render가 재시작되어도 유지됩니다.
- 편집 키가 없는 브라우저는 데이터를 볼 수 있지만 수정 내용을 서버에 저장할 수 없습니다.

## 온라인 배포

이 앱은 PUBG API 키를 서버에서 보호해야 하므로 정적 사이트가 아니라 Node 서버로 배포해야 합니다. Docker 배포를 추천합니다.

### Render

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Render에서 새 Blueprint 또는 Web Service를 만듭니다.
3. Blueprint를 쓰면 `render.yaml`이 `Dockerfile`을 사용해 배포합니다.
4. 환경변수 `PUBG_API_KEY`, `DATABASE_URL`, `APP_SYNC_TOKEN`을 넣습니다.
5. 배포가 끝나면 `https://서비스이름.onrender.com`에서 메인 화면을 열고, OBS에는 `https://서비스이름.onrender.com/obs.html`을 넣습니다.

### 배포된 사이트 수정하기

Render 서비스가 GitHub 저장소의 `main` 브랜치와 연결되어 있고 Auto-Deploy가 켜져 있다면:

1. 이 프로젝트의 코드를 수정합니다.
2. 변경 파일을 GitHub 저장소의 `main` 브랜치에 올립니다.
3. Render가 새 커밋을 감지해 자동으로 빌드하고 배포합니다.
4. Render 서비스의 **Events** 또는 **Deploys**에서 `Live` 상태를 확인합니다.

Auto-Deploy가 꺼져 있다면 Render 서비스에서 **Manual Deploy > Deploy latest commit**을 누릅니다.

환경 변수를 바꾼 경우 Render 서비스의 **Environment**에서 값을 수정한 뒤 **Save, rebuild, and deploy**를 선택합니다. `DATABASE_URL`, `APP_SYNC_TOKEN`, `PUBG_API_KEY`의 실제 값은 GitHub 파일이나 `render.yaml`에 적지 않습니다.

### Railway/Fly.io 같은 Docker 지원 플랫폼

Dockerfile을 그대로 사용하면 됩니다. 런타임 환경변수는 아래처럼 설정하세요.

```bash
NODE_ENV=production
HOST=0.0.0.0
PUBG_API_KEY=your-pubg-api-key
DATABASE_URL=postgresql://user:password@your-endpoint-pooler.neon.tech/database?sslmode=require
APP_SYNC_TOKEN=your-long-random-edit-key
```

## 동작 방식

- 플레이어 닉네임으로 최근 매치 ID를 조회합니다.
- 라운드별 매치 ID를 입력하면 해당 매치의 팀 번호, 등수, 킬 수를 가져옵니다.
- 순위 점수와 킬 점수는 화면에서 바로 수정할 수 있습니다.
- 기본 룰셋은 PUBG e스포츠에서 흔히 쓰는 `1등 10점, 2등 6점, 3등 5점, 4등 4점, 5등 3점, 6등 2점, 7~8등 1점, 킬당 1점`입니다.
- 팀명은 팀 번호 seed 기준으로 저장됩니다. 같은 팀 번호에 다른 팀원이 잡혀도 해당 seed에 점수가 누적됩니다.
- 최근 매치 목록에는 맵, 플레이 모드, 매치 타입, 같이한 팀원 요약이 표시됩니다.

## 주의

PUBG API의 매치 데이터 보관 기간은 공식 문서 기준 14일입니다. 오래된 매치 ID는 조회되지 않을 수 있습니다.
