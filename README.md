# PUBG Match Leaderboard

PUBG API에서 플레이어 최근 매치와 매치별 roster/participant 정보를 가져와 라운드별 팀 점수 리더보드를 계산하는 로컬 앱입니다.

## 실행

```bash
cp .env.example .env
# .env의 PUBG_API_KEY 값을 본인 키로 교체
node server.js
```

Codex 번들 Node를 사용할 때:

```bash
/Users/noah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

브라우저에서 `http://localhost:4177`을 열면 됩니다.

OBS Studio 브라우저 소스에는 `http://localhost:4177/obs.html`을 넣으면 됩니다. 메인 화면이 최신 집계를 서버에 발행하고, OBS 화면은 그 상태를 1초마다 읽습니다.

## 온라인 배포

이 앱은 PUBG API 키를 서버에서 보호해야 하므로 정적 사이트가 아니라 Node 서버로 배포해야 합니다. Docker 배포를 추천합니다.

### Render

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Render에서 새 Blueprint 또는 Web Service를 만듭니다.
3. Blueprint를 쓰면 `render.yaml`이 `Dockerfile`을 사용해 배포합니다.
4. 환경변수 `PUBG_API_KEY`에 PUBG API 키를 넣습니다.
5. 배포가 끝나면 `https://서비스이름.onrender.com`에서 메인 화면을 열고, OBS에는 `https://서비스이름.onrender.com/obs.html`을 넣습니다.

### Railway/Fly.io 같은 Docker 지원 플랫폼

Dockerfile을 그대로 사용하면 됩니다. 런타임 환경변수는 아래처럼 설정하세요.

```bash
NODE_ENV=production
HOST=0.0.0.0
PUBG_API_KEY=your-pubg-api-key
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
