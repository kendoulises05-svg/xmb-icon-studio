const categories = document.querySelectorAll('.category');
const subMenus = document.querySelectorAll('.sub-menu');
const activeLabel = document.querySelector('.active-label');

function setActiveCategory(categoryName) {
    categories.forEach((category) => {
        const isActive = category.dataset.category === categoryName;
        category.classList.toggle('active', isActive);
    });

    subMenus.forEach((menu) => {
        menu.classList.toggle('active', menu.id === `${categoryName}-menu`);
    });

    if (activeLabel) {
        activeLabel.textContent = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
    }
}

categories.forEach((category) => {
    category.addEventListener('click', () => setActiveCategory(category.dataset.category));
});

let currentIndex = 0;

function updateCurrentIndex() {
    currentIndex = Array.from(categories).findIndex((category) => category.classList.contains('active'));
    if (currentIndex === -1) currentIndex = 0;
}

updateCurrentIndex();

window.addEventListener('keydown', (event) => {
    const leftKeys = ['ArrowLeft', 'a', 'A'];
    const rightKeys = ['ArrowRight', 'd', 'D'];

    if (leftKeys.includes(event.key)) {
        currentIndex = (currentIndex - 1 + categories.length) % categories.length;
        setActiveCategory(categories[currentIndex].dataset.category);
        event.preventDefault();
    }

    if (rightKeys.includes(event.key)) {
        currentIndex = (currentIndex + 1) % categories.length;
        setActiveCategory(categories[currentIndex].dataset.category);
        event.preventDefault();
    }
});

window.addEventListener('resize', updateCurrentIndex);
