FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=development

EXPOSE 3000

CMD ["npm", "run", "dev"]
