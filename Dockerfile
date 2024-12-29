FROM node:22

WORKDIR /app

COPY package.json /app/

RUN npm install

RUN apt-get update && apt-get install -y cron

COPY .env /app/

COPY index.js /app/

RUN echo "* * * * * root cd /app && /usr/local/bin/node /app/index.js | tee -a /app/output/cron.log >> /dev/console 2>&1" > /etc/cron.d/script-cron

RUN chmod 0644 /etc/cron.d/script-cron

RUN crontab /etc/cron.d/script-cron

RUN mkdir -p /app/output

EXPOSE 8080

CMD ["cron", "-f"]
