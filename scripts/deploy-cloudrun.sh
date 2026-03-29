#!/bin/bash
set -euo pipefail

PROJECT=${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project)}
REGION=us-central1
SERVICE=ai-universe-blog
IMAGE=gcr.io/$PROJECT/$SERVICE

# Use short commit SHA as Docker tag
TAG=$(git rev-parse --short HEAD)

echo "Building Docker image: $IMAGE:$TAG"
docker build -t $IMAGE:$TAG .

echo "Pushing to GCR: $IMAGE:$TAG"
docker push $IMAGE:$TAG

echo "Deploying to Cloud Run: $SERVICE in $REGION"
gcloud run deploy $SERVICE \
  --image $IMAGE:$TAG \
  --region $REGION \
  --platform managed \
  --min-instances 1 \
  --max-instances 3 \
  --memory 256Mi \
  --set-env-vars "STORAGE_TYPE=firestore,NODE_ENV=production" \
  --allow-unauthenticated

echo "Deployed: $(gcloud run services describe $SERVICE --region $REGION --format 'value(status.url)')"
