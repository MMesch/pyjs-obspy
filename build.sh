#!/bin/bash

# Build script for pyjs-obspy demo
# This script creates the environment and sets up the deployment

set -e

echo "Building pyjs-obspy demo..."

# Check if micromamba is available
if ! command -v micromamba &> /dev/null; then
    echo "Error: micromamba not found. Please install micromamba first."
    echo "Installation instructions: https://mamba.readthedocs.io/en/latest/installation/micromamba-installation.html"
    exit 1
fi

# Check if empack is available
if ! command -v empack &> /dev/null; then
    echo "Error: empack not found. Please install empack first."
    echo "Installation: pip install empack"
    exit 1
fi

# Create environment
echo "Creating conda environment..."
micromamba create -f environment.yml --platform emscripten-wasm32 --prefix ./env

# Copy pyjs runtime files
echo "Copying pyjs runtime files..."
cp ./env/lib_js/pyjs/* .

# Pack the environment
echo "Packing environment with empack..."
empack pack env --env-prefix ./env --outdir .

# Organize files into packages directory
echo "Organizing package files..."
mkdir -p packages
mv *.tar.gz packages/

echo "Build completed successfully!"
echo ""
echo "To run the demo:"
echo "  python -m http.server 8000"
echo ""
echo "Then open http://localhost:8000 in your browser."