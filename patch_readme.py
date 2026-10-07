import re

with open('README.md', 'r', encoding='utf-8') as f:
    text = f.read()

compose_content = '''### Option 1: Docker Compose (Recommended)

You can run the application easily using docker-compose. 
Here is the configuration used in the docker-compose.yml file:

`yaml
version: '3.8'

services:
  favyt:
    build: .
    image: favyt:latest
    container_name: favyt
    restart: unless-stopped
    ports:
      - "8245:8245"
    volumes:
      - ./data:/app/data
    environment:
      - DATA_DIR=/app/data
      - TZ=Europe/Berlin
`

**Steps to start:**
1. Clone or download this repository.
2. Open a terminal in the project directory.
3. Run the following command:

`ash
docker compose up -d --build
`'''

# Find the section to replace
text = re.sub(
    r'### Option 1: Docker Compose \(Recommended\).*?`ash\ndocker compose up -d --build\n`', 
    compose_content, 
    text, 
    flags=re.DOTALL
)

with open('README.md', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated README')
