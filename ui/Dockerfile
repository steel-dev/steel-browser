FROM node:18

WORKDIR /app
# Set default values that can be overridden
ARG VITE_API_URL=http://localhost:3000
ARG VITE_WS_URL=ws://localhost:3000
ARG VITE_OPENAPI_URL=http://localhost:3000/documentation/json

# Make the build args available as environment variables during build
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
ENV VITE_OPENAPI_URL=${VITE_OPENAPI_URL}

LABEL org.opencontainers.image.source="https://github.com/steel-dev/steel-browser"

# Copy package.json and package-lock.json first
COPY package.json package-lock.json ./

# Install the npm packages directly in the Docker container's working directory
RUN npm install

# Copy the rest of the application, excluding node_modules
# .dockerignore should have an entry for node_modules to exclude it
COPY . .

# Build the application
RUN npm run build

# Expose the port your web server runs on, assuming it's 5173
EXPOSE 5173

# Command to run your web server
CMD ["npm", "run", "start"]
