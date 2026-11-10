# Kubernetes

Production runs on Liip's Kubernetes cluster, in the namespace `liip-parlaqui`. **ArgoCD** deploys the Helm
chart in `kubernetes/infra/prod` from `main`, and the **External Secrets Operator** reads the secrets from this
project's GitLab CI/CD variables.

```
kubernetes/
├── bootstrap/prod/app.yml     ArgoCD Application, applied once by hand
└── infra/prod/                Helm chart that ArgoCD deploys
    ├── Chart.yaml             appVersion written by the deploy:production job
    ├── values.yaml            host, image tag, env, secrets
    └── templates/             deployment (one pod, Recreate), service, ingress, PVC, config map, external secrets
```

## What runs

One pod with one container, the image of this repository's `Dockerfile`, on port 3000. The SQLite database
lives on a 2 GiB `ReadWriteOnce` volume (about 4 KB per finished game, kept for good; the volume also holds the write-ahead log and `backup.db`) at `/data`, so there is one pod only, and `strategy: Recreate` stops the
old pod before the new one attaches the volume. The probes call `/healthz` with `Host: localhost`, since the app
redirects every other host name to `ORIGIN`.

The app does its daily work itself, so there is no CronJob: the roster import (see `docs/import.md`), the
prunes and the snapshot `/data/backup.db`.

## One-time setup

1. A namespace with an ArgoCD project, and a secret that lets External Secrets read this project's CI/CD
   variables. The cluster's user needs read access to this project, to pull the image and read the chart.
2. GitLab CI/CD variables (masked, protected): `PROD_PARL_API_KEY`, `PROD_ROKKA_API_KEY` (an upload-only key),
   `PROD_IMPORT_TOKEN` and `PROD_INSIGHTS_TOKEN` (`openssl rand -hex 24` each).
3. A Project Access Token (*Settings → Access tokens*), role *Maintainer*, scope `write_repository`, stored as
   the CI/CD variable `GITOPS_PUSH_TOKEN` (masked, protected). If `main` is protected, allow its bot user to push.
4. Protect `v*` tags (*Settings → Repository → Protected tags*): protected variables only reach protected refs.
5. `kubectl apply -f kubernetes/bootstrap/prod/app.yml`

## Releasing

1. Tag the commit on `main`: `git tag v1.2.3 && git push origin v1.2.3`.
2. The tag pipeline runs the tests and builds `app:v1-2-3`.
3. Start `deploy:production` by hand. It writes the image tag into `values.yaml` on `main` (`[skip ci]`), and
   ArgoCD rolls it out. `verify:production` waits until `/vcs_branch_sha` serves the tagged commit.

A change to the chart itself deploys as soon as it is merged into `main`. Roll back from *Operate → Environments →
production* by re-deploying an earlier deployment.

## Checking

```bash
kubectl get pods,svc,ingress,pvc,externalsecrets
kubectl logs deploy/parlaqui
scripts/readiness.sh https://parlaqui.ch --production
```

## Backups

The cluster does not back up volumes. The app writes `/data/backup.db` once a day, but on the same volume, so
copy it off the cluster as well, for example by hand:

```bash
kubectl cp "$(kubectl get pod -l app=parlaqui -o name | cut -d/ -f2)":/data/backup.db ./parlaqui-backup.db
```
