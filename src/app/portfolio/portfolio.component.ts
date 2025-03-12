import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, AfterViewInit, Renderer2, ElementRef } from '@angular/core';

declare var data: any;

@Component({
    selector: 'app-portfolio',
    templateUrl: './portfolio.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ['./portfolio.component.css'],
    standalone: false
})
export class PortfolioComponent implements OnInit, AfterViewInit {
    public portfolioData = data['Portfolio'].map((project: any, index: number) => ({
        ...project,
        hoverDescription: this.getHoverDescription(index)
    }));

    constructor(private changeDetectorRef: ChangeDetectorRef, private renderer: Renderer2, private elRef: ElementRef) {
        changeDetectorRef.detach();
    }

    ngOnInit(): void {
        this.changeDetectorRef.detectChanges();
    }

    ngAfterViewInit(): void {
        document.addEventListener("handHover", (event: any) => {
            this.handleHandHover(event.detail);
        });
    }

    private handleHandHover(element: HTMLElement) {
        if (element.classList.contains("item-box")) {
            this.renderer.addClass(element, "hover-effect");
            console.log("🎯 Angular: Aplicando hover-effect en Portfolio.");
        }
    }

    private getHoverDescription(index: number): string {
        const descriptions = [
            "",
            "",
            ""
        ];
        return descriptions[index] || "";
    }
}
