# Docker disk-cleanup playbook (Fin-Eye dev stack on Windows)

The Fin-Eye `docker-compose.yml` brings up ~12 services (Postgres, RabbitMQ,
Qdrant, SeaweedFS, Mailhog, Prometheus, Grafana, FastAPI, Celery worker,
Beat, Flower, optional LocalStack). On Windows + Docker Desktop the data
ends up inside a single WSL2 virtual disk that **never auto-shrinks**, so
"my C: drive is full" almost always means "Docker's `ext4.vhdx` /
`docker_data.vhdx` has bloated and isn't reclaiming space".

This playbook lists the cleanups in order of safety. Run them top to
bottom — most people never need to go past step 3.

---

## 1. Stop the stack cleanly first

```powershell
# from the repo root, in PowerShell or git-bash
docker compose down            # keep volumes (Postgres, Qdrant, uploads)
# OR, only if you also want to delete uploaded PDFs + extracted JSON:
# docker compose down -v       # DESTROYS pgdata, qdrant_data, seaweedfs_data
```

Keep `down` (no `-v`) the first time. The named volumes contain your
indexed corpus; losing them means re-uploading and re-indexing every
document.

---

## 2. Reclaim the easy wins (safe — no app data lost)

```powershell
# 2a. Remove dangling images, stopped containers, unused networks.
docker system prune -af

# 2b. Drop the BuildKit layer cache (often 5–20 GB on its own).
docker builder prune -af

# 2c. Clear unused volumes ONLY (skips ones any container is currently
# attached to). This is still safe while `docker compose up` is down,
# because Compose volumes are unattached when nothing is running. Read
# the list it prints before confirming.
docker volume ls -qf dangling=true | ForEach-Object { docker volume rm $_ }
```

`docker system df` after each step shows what was reclaimed.

> **Never** add `--volumes` to `docker system prune` without first running
> `docker volume ls` and checking that none of `pgdata`, `qdrant_data`,
> `rabbitmq_data`, `seaweedfs_data`, `uploads`, `hf_cache` are listed.

---

## 3. Compact the WSL2 virtual disk (biggest single reclaim)

Docker Desktop on Windows runs everything inside a WSL2 distro
(`docker-desktop-data` or `docker-desktop`). Its disk image grows when
new layers/data are written but **never shrinks** when you delete them
— even after `docker system prune` finishes.

```powershell
# Shut everything down so the vhdx is unlocked.
wsl --shutdown

# Locate the disk. Path differs by Docker Desktop version:
#   - Docker Desktop 4.34+ : %LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx
#   - older versions       : %LOCALAPPDATA%\Docker\wsl\data\ext4.vhdx
$vhdx = "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx"
if (-not (Test-Path $vhdx)) {
    $vhdx = "$env:LOCALAPPDATA\Docker\wsl\data\ext4.vhdx"
}
"VHDX path: $vhdx"

# Run an elevated (admin) PowerShell, then:
diskpart
```

In `diskpart`:

```text
select vdisk file="C:\Users\<you>\AppData\Local\Docker\wsl\disk\docker_data.vhdx"
attach vdisk readonly
compact vdisk
detach vdisk
exit
```

Watching `dir` on `C:\` before/after typically frees 10–40 GB. Restart
Docker Desktop afterwards.

---

## 4. Move Docker's data root off C: (one-time fix)

If C: is permanently tight, point Docker Desktop at another drive once
and forget about it:

1. Docker Desktop → Settings → **Resources** → **Disk image location**.
2. Pick a folder on D:/E: with at least 60 GB free.
3. Apply. Docker copies the existing image and switches over.

After this, all future image/layer/volume growth lands on the new drive.

---

## 5. Slim the Fin-Eye footprint while you work

The compose file uses [profiles](https://docs.docker.com/compose/profiles/)
specifically so monitoring + AWS containers stay off by default. Stick
to the lean set when you don't need them:

```bash
# Lean dev — no Prometheus, no Grafana, no Flower, no LocalStack
docker compose up db redis rabbitmq qdrant seaweedfs mailhog api worker beat
```

Heavy containers worth stopping when idle, even on the lean set:

| Container             | Why it's heavy                                  |
|-----------------------|-------------------------------------------------|
| `finsight_qdrant`     | Loads collection + HNSW index into RAM          |
| `finsight_worker`     | Holds MiniLM + cross-encoder + spaCy in RAM     |
| `finsight_seaweedfs`  | Master + volume + filer all in one process      |

Stop them targeted: `docker compose stop worker beat` — the API and
Postgres alone fit in ~600 MB RAM.

To stop the whole stack without losing data:
`docker compose stop` (vs. `down` — `stop` keeps the containers around).

---

## 6. Find what's still taking space

```bash
# Largest images
docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}" | sort -k2 -h

# Largest volumes (run inside any container)
docker run --rm -v pgdata:/v alpine du -sh /v
docker run --rm -v qdrant_data:/v alpine du -sh /v
docker run --rm -v hf_cache:/v alpine du -sh /v

# What every Docker resource consumes right now
docker system df -v
```

The HuggingFace cache (`hf_cache` volume) tends to be the biggest dev
volume after Postgres — it stores the MiniLM dense + BM25 sparse +
cross-encoder + FinBERT models. That's expected; deleting it only saves
~1.5 GB and forces a re-download on next worker start.

---

## 7. Last resort — full reset

If nothing else helps and you genuinely don't need any indexed data:

```powershell
docker compose down -v             # WIPES pgdata, qdrant_data, seaweedfs_data
docker system prune -af --volumes  # nukes every other dangling volume
# Then step 3 (compact vhdx) again to actually return the bytes to C:.
```

Plan to re-upload and re-process every document after this. The
extractor + chunker + embedder run automatically through the Celery
worker, so the rebuild is "drag the PDFs back into the workspace and
wait for status `indexed`."
