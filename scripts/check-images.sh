#!/usr/bin/env sh
# Vérifie que chaque image Docker référencée (FROM des Dockerfile, image: des compose)
# existe encore sur son registre. Interroge l'API Registry v2 directement : pas besoin
# du démon Docker, seulement de curl. Lancé par le hook pre-commit et par la CI.
set -eu

cd "$(dirname "$0")/.."

ACCEPT='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'

# Liste les références : FROM <image> [AS x] et image: <image>. Ignore scratch, les variables
# et les étapes internes du multi-stage (FROM build).
list_images() {
  stages=$(grep -hiE '^[[:space:]]*FROM[[:space:]].*[[:space:]]AS[[:space:]]' $(find . -name 'Dockerfile*' -not -path './.git/*' -not -path './node_modules/*') 2>/dev/null \
    | awk '{print tolower($NF)}' || true)
  find . \( -name 'Dockerfile*' -o -name '*compose*.yml' -o -name '*compose*.yaml' \) \
      -not -path './.git/*' -not -path './node_modules/*' -type f \
    | while read -r f; do
        case "$f" in
          *compose*) sed -n 's/^[[:space:]]*image:[[:space:]]*["'\'']\{0,1\}\([^"'\'' #]*\).*/\1/p' "$f" ;;
          *) awk 'toupper($1)=="FROM" { for (i=2; i<=NF; i++) if ($i !~ /^--/) { print $i; break } }' "$f" ;;
        esac
      done \
    | while read -r img; do
        case "$img" in scratch|*'$'*) continue ;; esac
        echo "$stages" | grep -qx "$(echo "$img" | tr 'A-Z' 'a-z')" && continue
        echo "$img"
      done | sort -u
}

# nginx:1.27 -> registry-1.docker.io library/nginx 1.27 ; ghcr.io/a/b@sha256:… -> ghcr.io a/b sha256:…
check_image() {
  ref=$1
  case "$ref" in
    *@*) name=${ref%@*}; tag=${ref#*@} ;;
    *) name=$ref; tag=latest
       last=${ref##*/}
       case "$last" in *:*) name=${ref%:*}; tag=${ref##*:} ;; esac ;;
  esac
  first=${name%%/*}
  case "$name" in
    */*) case "$first" in
           *.*|*:*|localhost) registry=$first; repo=${name#*/} ;;
           *) registry=docker.io; repo=$name ;;
         esac ;;
    *) registry=docker.io; repo=library/$name ;;
  esac
  [ "$registry" = docker.io ] && registry=registry-1.docker.io
  url="https://$registry/v2/$repo/manifests/$tag"

  # Premier appel anonyme : un 401 donne l'adresse du jeton (WWW-Authenticate).
  headers=$(curl -sSI --max-time 15 -H "Accept: $ACCEPT" "$url") || {
    echo "  ✗ $ref : registre $registry injoignable"; return 1; }
  code=$(echo "$headers" | head -1 | awk '{print $2}')
  if [ "$code" = 401 ]; then
    auth=$(echo "$headers" | tr -d '\r' | grep -i '^www-authenticate:' | head -1)
    realm=$(echo "$auth" | sed -n 's/.*realm="\([^"]*\)".*/\1/p')
    service=$(echo "$auth" | sed -n 's/.*service="\([^"]*\)".*/\1/p')
    token=$(curl -sS --max-time 15 -G "$realm" --data-urlencode "service=$service" \
              --data-urlencode "scope=repository:$repo:pull" \
            | sed -nE 's/.*"(token|access_token)"[[:space:]]*:[[:space:]]*"([^"]*)".*/\2/p')
    code=$(curl -sS -o /dev/null -w '%{http_code}' -I --max-time 15 \
             -H "Accept: $ACCEPT" -H "Authorization: Bearer $token" "$url") || code=000
  fi

  case "$code" in
    200) echo "  ✓ $ref" ;;
    404) echo "  ✗ $ref : tag introuvable sur $registry"; return 1 ;;
    *)   echo "  ✗ $ref : réponse HTTP $code de $registry"; return 1 ;;
  esac
}

images=$(list_images)
if [ -z "$images" ]; then
  echo "Aucune image Docker référencée."
  exit 0
fi

echo "Disponibilité des images Docker :"
failed=0
for img in $images; do
  check_image "$img" || failed=1
done

if [ "$failed" -ne 0 ]; then
  echo "Une image au moins n'est plus disponible : corriger le tag avant de commiter."
  exit 1
fi
