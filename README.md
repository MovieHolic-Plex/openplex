<h1 align="center">OpenPlex</h1>

<p align="center">
  <strong>내 미디어를, 내 서버에서.</strong><br/>
  Plex처럼 보이지만 로컬 파일과 공식 메타데이터만으로 돌아가는 오픈 소스 미디어 서버.
</p>

<p align="center">
  <a href="#설치"><img alt="설치" src="https://img.shields.io/badge/설치-npm-111?style=for-the-badge" /></a>
  <a href="#라이선스"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-e11d48?style=for-the-badge" /></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/EN-readme-2563eb?style=for-the-badge" /></a>
</p>

---

## 한 줄로

폴더를 지정하고 스캔하면, 작품 카드·이어보기·프로필·한글 메타데이터가 생깁니다.  
재생 소스는 **당신이 가진 파일**입니다. 외부 사이트 스크레이핑은 이 저장소에 없습니다.

## 할 수 있는 일

| | |
|---|---|
| **보관함** | 영화 / 시리즈 / 만화. 정렬·필터 칩이 서버 쿼리까지 갑니다. |
| **방문자 모드** | 공개된 작품만. 검색·다운로드·에이전트는 숨깁니다. |
| **메타데이터** | TMDB(한국어) → KMDb → 한국 사이트는 제목·연도·장르·줄거리·포스터만. |
| **에이전트** | 폴더 지정 → 스캔 → 메타 보강을 한 지시로. |
| **플러그인** | 당신만의 소스는 `plugins/`에 꽂습니다. 공개 저장소에는 포함되지 않습니다. |

## 설치

```bash
git clone https://github.com/MovieHolic-Plex/openplex.git
cd openplex
cp .env.example .env
npm install
npm run build
npm start
```

브라우저에서 `http://127.0.0.1:33888`.

개발 모드:

```bash
npm run dev:server   # Fastify
npm run dev:client   # Vite
```

### 사전 준비

- **Node.js 20+**
- `better-sqlite3`는 네이티브 모듈입니다. 대부분의 환경은 prebuilt를 받습니다. 소스 빌드가 필요하면 Python과 컴파일 도구가 필요합니다.
- 이 저장소의 `npm install`은 DRM/우회 네이티브를 빌드하지 **않습니다**.

## 환경변수

복사본은 [`.env.example`](.env.example)에 있습니다. 자주 쓰는 것만:

| 변수 | 기본 | 설명 |
|---|---|---|
| `OPENPLEX_BIND` | `127.0.0.1` | 루프백 기본. LAN 바인드는 `OPENPLEX_AUTH_TOKEN` 필수 |
| `PORT` | `33888` | 미디어 서버 포트 |
| `OPENPLEX_DATA_PATH` | `.data` | SQLite와 설정 |
| `OPENPLEX_MEDIA_PATH` | `.data/media` | 로컬 미디어 루트 |
| `KMDB_API_KEY` | — | 있으면 KMDb를 체인에 넣음 |
| `DEEPSEEK_API_KEY` | — | 에이전트 |

진짜 키를 커밋하지 마세요.

## 구조

```
client/     React + Vite UI
server/     Fastify API, 스캔, HLS 게이트웨이, 에이전트
shared/     공통 타입
plugins/    로컬 전용 확장 (gitignore)
```

새 소스를 붙이려면 `docs/adapters.md`를 보세요.

## 테스트

```bash
npm test                          # 서버 vitest
npx playwright test               # UI (먼저 cd client && npm run build)
npm run typecheck && npm run lint
```

## 주의

이 프로젝트는 **본인이 소유한 미디어**를 정리하고 재생하기 위한 것입니다.  
붙이는 소스의 합법성은 사용자 책임입니다. 저작권 우회·DRM 해제 코드는 이 저장소에 없습니다.

## 라이선스

[MIT](LICENSE)
